import { LinearClient } from '@linear/sdk';
import { config } from './config.js';

const client = new LinearClient({ apiKey: config.linear.apiKey });

export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.schedule.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

let cache = {
  team: null,
  projects: new Map(),
  states: new Map(),
  blockedLabel: null,
  me: null,
};

export async function init() {
  const teams = await client.teams({ filter: { key: { eq: config.linear.teamKey } } });
  const team = teams.nodes[0];
  if (!team) throw new Error(`Linear team "${config.linear.teamKey}" not found.`);
  cache.team = team;

  const projects = await team.projects();
  for (const p of projects.nodes) cache.projects.set(p.name.toLowerCase(), p);

  const states = await team.states();
  for (const s of states.nodes) cache.states.set(s.name.toLowerCase(), s);

  const labels = await team.labels();
  cache.blockedLabel = labels.nodes.find(l => l.name.toLowerCase() === 'blocked');
  if (!cache.blockedLabel) {
    const res = await client.createIssueLabel({
      teamId: team.id,
      name: 'blocked',
      color: '#eb5757',
    });
    cache.blockedLabel = await res.issueLabel;
  }

  cache.me = await client.viewer;
  return cache;
}

export function getTeam() { return cache.team; }

export function getProjectByArea(area) {
  if (!area) return null;
  return cache.projects.get(area.toLowerCase()) || null;
}

export function listAreas() {
  return Array.from(cache.projects.values()).map(p => p.name);
}

function stateByName(name) {
  return cache.states.get(name.toLowerCase());
}

const PRIORITY_BY_CODE = new Map([
  ['p0', 1],
  ['urgent', 1],
  ['p1', 2],
  ['high', 2],
  ['p2', 3],
  ['normal', 3],
  ['medium', 3],
  ['p3', 4],
  ['low', 4],
  ['p4', 0],
  ['none', 0],
  ['no priority', 0],
]);

export function normalizePriority(priority) {
  if (priority === null || priority === undefined || priority === '') return undefined;
  if (typeof priority === 'number') {
    if (Number.isInteger(priority) && priority >= 0 && priority <= 4) return priority;
    throw new Error(`Invalid Linear priority "${priority}". Use P0, P1, P2, P3, or P4.`);
  }
  const key = String(priority).trim().toLowerCase();
  if (!PRIORITY_BY_CODE.has(key)) {
    throw new Error(`Invalid priority "${priority}". Use P0, P1, P2, P3, or P4.`);
  }
  return PRIORITY_BY_CODE.get(key);
}

export function priorityCode(priority) {
  const normalized = normalizePriority(priority);
  if (normalized === undefined) return '';
  if (normalized === 1) return 'P0';
  if (normalized === 2) return 'P1';
  if (normalized === 3) return 'P2';
  if (normalized === 4) return 'P3';
  return 'P4';
}

export async function ensureProject(name) {
  const existing = cache.projects.get(name.toLowerCase());
  if (existing) return existing;
  const res = await client.createProject({
    teamIds: [cache.team.id],
    name,
  });
  const project = await res.project;
  cache.projects.set(project.name.toLowerCase(), project);
  return project;
}

export async function createIssue({ title, area, dueDate, description, context, priority }) {
  const project = area ? getProjectByArea(area) : null;
  const state = dueDate ? (stateByName('todo') || stateByName('in progress')) : stateByName('backlog');
  const body = description || context || undefined;
  const normalizedPriority = normalizePriority(priority);
  const res = await client.createIssue({
    teamId: cache.team.id,
    title,
    description: body,
    projectId: project?.id,
    stateId: state?.id,
    dueDate,
    priority: normalizedPriority,
    assigneeId: cache.me.id,
  });
  return await res.issue;
}

export async function findIssue(ref) {
  if (/^[A-Z][A-Z0-9]*-\d+$/i.test(ref)) {
    try {
      return await client.issue(ref.toUpperCase());
    } catch {
      return null;
    }
  }
  const issues = await client.issues({
    filter: {
      team: { id: { eq: cache.team.id } },
      state: { type: { nin: ['completed', 'canceled'] } },
      title: { containsIgnoreCase: ref },
    },
    first: 10,
  });
  return issues.nodes;
}

export async function setState(issueId, stateName) {
  const state = stateByName(stateName);
  if (!state) {
    const fallback = stateName === 'cancelled' ? stateByName('canceled') : null;
    if (!fallback) throw new Error(`Linear state "${stateName}" not found in this team.`);
    await client.updateIssue(issueId, { stateId: fallback.id });
    return;
  }
  await client.updateIssue(issueId, { stateId: state.id });
}

export async function setDueDate(issueId, dueDate) {
  await client.updateIssue(issueId, { dueDate });
}

export async function setPriority(issueId, priority) {
  await client.updateIssue(issueId, { priority: normalizePriority(priority) });
}

export async function updateIssueFields(issueId, fields) {
  const input = {};
  if (fields.title !== undefined) input.title = fields.title;
  if (fields.description !== undefined) input.description = fields.description;
  if (fields.dueDate !== undefined) input.dueDate = fields.dueDate;
  if (fields.priority !== undefined) {
    const normalized = normalizePriority(fields.priority);
    if (normalized !== undefined) input.priority = normalized;
  }

  if (Object.keys(input).length === 0) {
    throw new Error('No supported issue fields were provided to update.');
  }

  const res = await client.updateIssue(issueId, input);
  return await res.issue;
}

export async function moveToToday(issueId) {
  const today = todayLocal();
  const state = stateByName('todo');
  await client.updateIssue(issueId, { dueDate: today, stateId: state?.id });
}

export async function markBlocked(issueId, reason) {
  const issue = await client.issue(issueId);
  const labels = await issue.labels();
  const labelIds = [...labels.nodes.map(l => l.id), cache.blockedLabel.id];
  await client.updateIssue(issueId, { labelIds });
  if (reason) {
    await client.createComment({ issueId, body: `🚧 Blocked: ${reason}` });
  }
}

export async function markDone(issueId) {
  await setState(issueId, 'done');
}

export async function markDropped(issueId) {
  try {
    await setState(issueId, 'cancelled');
  } catch {
    await setState(issueId, 'canceled');
  }
}

export async function getTodayList() {
  const today = todayLocal();
  const issues = await client.issues({
    filter: {
      team: { id: { eq: cache.team.id } },
      state: { type: { nin: ['completed', 'canceled'] } },
      or: [
        { dueDate: { lte: today } },
        { state: { type: { eq: 'started' } } },
      ],
    },
    orderBy: 'updatedAt',
    first: 50,
  });
  return issues.nodes;
}

export async function getOverdue() {
  const today = todayLocal();
  const issues = await client.issues({
    filter: {
      team: { id: { eq: cache.team.id } },
      state: { type: { nin: ['completed', 'canceled'] } },
      dueDate: { lt: today },
    },
    first: 50,
  });
  return issues.nodes;
}

export async function getInbox() {
  const issues = await client.issues({
    filter: {
      team: { id: { eq: cache.team.id } },
      state: { type: { eq: 'backlog' } },
    },
    first: 50,
  });
  return issues.nodes;
}

export async function getInProgress() {
  const issues = await client.issues({
    filter: {
      team: { id: { eq: cache.team.id } },
      state: { type: { eq: 'started' } },
    },
    first: 50,
  });
  return issues.nodes;
}

export async function getRecentlyDone(sinceISO) {
  const issues = await client.issues({
    filter: {
      team: { id: { eq: cache.team.id } },
      state: { type: { eq: 'completed' } },
      completedAt: { gte: sinceISO },
    },
    first: 50,
  });
  return issues.nodes;
}

export async function formatIssue(issue) {
  const project = await issue.project;
  const state = await issue.state;
  const due = issue.dueDate ? ` · due ${issue.dueDate}` : '';
  const area = project ? ` · ${project.name}` : '';
  const priority = issue.priority && issue.priority > 0 ? ` · ${priorityCode(issue.priority)} ${issue.priorityLabel}` : '';
  return `\`${issue.identifier}\` ${issue.title} _(${state?.name}${area}${due}${priority})_`;
}
