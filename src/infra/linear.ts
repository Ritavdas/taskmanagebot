import { LinearClient, type Issue, type Project, type Team, type WorkflowState, type IssueLabel } from '@linear/sdk';
import {
  type Task,
  type PriorityCode,
  type TaskInput,
  priorityToLinearNumber,
  priorityFromLinearNumber,
} from '../domain/task.ts';

/** Strip undefined values; Linear SDK input types don't accept undefined. */
function defined<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}
import { todayLocal } from '../domain/date.ts';

export interface IssueUpdateFields {
  title?: string;
  description?: string;
  /** undefined = leave alone, null = clear, string = set */
  dueDate?: string | null;
  priority?: PriorityCode;
}

export interface FindIssueResult {
  exact?: Task;
  matches?: Task[];
}

export interface LinearAdapter {
  init(): Promise<void>;
  listAreas(): string[];
  ensureProject(name: string): Promise<{ name: string }>;
  createIssue(input: TaskInput): Promise<Task>;
  findIssue(ref: string): Promise<FindIssueResult>;
  updateIssue(id: string, fields: IssueUpdateFields): Promise<Task>;
  moveToToday(id: string): Promise<void>;
  markBlocked(id: string, reason: string | null): Promise<void>;
  markDone(id: string): Promise<void>;
  markDropped(id: string): Promise<void>;
  setState(id: string, name: 'backlog' | 'todo' | 'in progress' | 'done' | 'cancelled'): Promise<void>;
  setDueDate(id: string, dueDate: string | null): Promise<void>;
  setPriority(id: string, priority: PriorityCode): Promise<void>;
  getTodayList(): Promise<Task[]>;
  getOverdue(): Promise<Task[]>;
  getInbox(): Promise<Task[]>;
  getInProgress(): Promise<Task[]>;
  getRecentlyDone(sinceISO: string): Promise<Task[]>;
  formatIssue(task: Task): string;
}

interface Cache {
  team: Team;
  projects: Map<string, Project>;
  states: Map<string, WorkflowState>;
  blockedLabel: IssueLabel;
  meId: string;
}

function priorityCode(task: Task): string {
  return task.priority ?? '';
}

function formatTask(task: Task): string {
  const due = task.dueDate ? ` · due ${task.dueDate}` : '';
  const area = task.areaName ? ` · ${task.areaName}` : '';
  const prio = task.priority && task.priority !== 'P4'
    ? ` · ${task.priority} ${task.priorityLabel ?? ''}`.trimEnd()
    : '';
  return `\`${task.identifier}\` ${task.title} _(${task.stateName}${area}${due}${prio})_`;
}

export function createLinearAdapter(opts: { apiKey: string; teamKey: string; timezone: string }): LinearAdapter {
  const client = new LinearClient({ apiKey: opts.apiKey });
  let cache: Cache | null = null;

  function requireCache(): Cache {
    if (!cache) throw new Error('LinearAdapter not initialized. Call init() first.');
    return cache;
  }

  async function toTask(issue: Issue): Promise<Task> {
    const [project, state] = await Promise.all([issue.project, issue.state]);
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      stateName: state?.name ?? 'unknown',
      stateType: state?.type ?? 'unknown',
      areaName: project?.name ?? null,
      dueDate: issue.dueDate ?? null,
      priority: priorityFromLinearNumber(issue.priority),
      priorityLabel: issue.priorityLabel ?? null,
    };
  }

  function stateByName(name: string): WorkflowState | undefined {
    return requireCache().states.get(name.toLowerCase());
  }

  function stateOrAlias(name: string): WorkflowState | undefined {
    return stateByName(name) ?? (name === 'cancelled' ? stateByName('canceled') : undefined);
  }

  return {
    async init() {
      const teams = await client.teams({ filter: { key: { eq: opts.teamKey } } });
      const team = teams.nodes[0];
      if (!team) throw new Error(`Linear team "${opts.teamKey}" not found.`);

      const projectsRes = await team.projects();
      const projects = new Map<string, Project>();
      for (const p of projectsRes.nodes) projects.set(p.name.toLowerCase(), p);

      const statesRes = await team.states();
      const states = new Map<string, WorkflowState>();
      for (const s of statesRes.nodes) states.set(s.name.toLowerCase(), s);

      const labelsRes = await team.labels();
      let blockedLabel = labelsRes.nodes.find(l => l.name.toLowerCase() === 'blocked');
      if (!blockedLabel) {
        const res = await client.createIssueLabel({
          teamId: team.id,
          name: 'blocked',
          color: '#eb5757',
        });
        const created = await res.issueLabel;
        if (!created) throw new Error('Failed to create "blocked" label.');
        blockedLabel = created;
      }

      const viewer = await client.viewer;
      cache = { team, projects, states, blockedLabel, meId: viewer.id };
    },

    listAreas() {
      return Array.from(requireCache().projects.values()).map(p => p.name);
    },

    async ensureProject(name) {
      const c = requireCache();
      const existing = c.projects.get(name.toLowerCase());
      if (existing) return { name: existing.name };
      const res = await client.createProject({ teamIds: [c.team.id], name });
      const project = await res.project;
      if (!project) throw new Error(`Failed to create project "${name}".`);
      c.projects.set(project.name.toLowerCase(), project);
      return { name: project.name };
    },

    async createIssue(input) {
      const c = requireCache();
      const project = input.area ? c.projects.get(input.area.toLowerCase()) : undefined;
      const state = input.dueDate
        ? (stateByName('todo') ?? stateByName('in progress'))
        : stateByName('backlog');
      const body = input.context ?? undefined;
      const priorityNum = input.priority ? priorityToLinearNumber(input.priority) : undefined;

      const res = await client.createIssue(defined({
        teamId: c.team.id,
        title: input.title,
        description: body,
        projectId: project?.id,
        stateId: state?.id,
        dueDate: input.dueDate ?? undefined,
        priority: priorityNum,
        assigneeId: c.meId,
      }));
      const issue = await res.issue;
      if (!issue) throw new Error('Failed to create issue.');
      return toTask(issue);
    },

    async findIssue(ref) {
      const c = requireCache();
      if (/^[A-Z][A-Z0-9]*-\d+$/i.test(ref)) {
        try {
          const issue = await client.issue(ref.toUpperCase());
          return { exact: await toTask(issue) };
        } catch {
          return {};
        }
      }
      const res = await client.issues({
        filter: {
          team: { id: { eq: c.team.id } },
          state: { type: { nin: ['completed', 'canceled'] } },
          title: { containsIgnoreCase: ref },
        },
        first: 10,
      });
      const matches = await Promise.all(res.nodes.map(toTask));
      if (matches.length === 1 && matches[0]) return { exact: matches[0] };
      return { matches };
    },

    async updateIssue(id, fields) {
      const input: Record<string, unknown> = {};
      if (fields.title !== undefined) input['title'] = fields.title;
      if (fields.description !== undefined) input['description'] = fields.description;
      if (fields.dueDate !== undefined) input['dueDate'] = fields.dueDate;
      if (fields.priority !== undefined) input['priority'] = priorityToLinearNumber(fields.priority);
      if (Object.keys(input).length === 0) {
        throw new Error('No supported issue fields were provided to update.');
      }
      const res = await client.updateIssue(id, input);
      const issue = await res.issue;
      if (!issue) throw new Error('Failed to update issue.');
      return toTask(issue);
    },

    async moveToToday(id) {
      const today = todayLocal(opts.timezone);
      const state = stateByName('todo');
      await client.updateIssue(id, defined({ dueDate: today, stateId: state?.id }));
    },

    async markBlocked(id, reason) {
      const c = requireCache();
      const issue = await client.issue(id);
      const labels = await issue.labels();
      const labelIds = [...labels.nodes.map(l => l.id), c.blockedLabel.id];
      await client.updateIssue(id, { labelIds });
      if (reason) {
        await client.createComment({ issueId: id, body: `🚧 Blocked: ${reason}` });
      }
    },

    async markDone(id) {
      const state = stateByName('done');
      if (!state) throw new Error('Linear state "done" not found.');
      await client.updateIssue(id, { stateId: state.id });
    },

    async markDropped(id) {
      const state = stateOrAlias('cancelled');
      if (!state) throw new Error('Linear state "cancelled"/"canceled" not found.');
      await client.updateIssue(id, { stateId: state.id });
    },

    async setState(id, name) {
      const state = stateOrAlias(name);
      if (!state) throw new Error(`Linear state "${name}" not found.`);
      await client.updateIssue(id, { stateId: state.id });
    },

    async setDueDate(id, dueDate) {
      await client.updateIssue(id, { dueDate });
    },

    async setPriority(id, priority) {
      await client.updateIssue(id, { priority: priorityToLinearNumber(priority) });
    },

    async getTodayList() {
      const c = requireCache();
      const today = todayLocal(opts.timezone);
      const res = await client.issues({
        filter: {
          team: { id: { eq: c.team.id } },
          state: { type: { nin: ['completed', 'canceled'] } },
          or: [
            { dueDate: { lte: today } },
            { state: { type: { eq: 'started' } } },
          ],
        },
        first: 50,
      });
      return Promise.all(res.nodes.map(toTask));
    },

    async getOverdue() {
      const c = requireCache();
      const today = todayLocal(opts.timezone);
      const res = await client.issues({
        filter: {
          team: { id: { eq: c.team.id } },
          state: { type: { nin: ['completed', 'canceled'] } },
          dueDate: { lt: today },
        },
        first: 50,
      });
      return Promise.all(res.nodes.map(toTask));
    },

    async getInbox() {
      const c = requireCache();
      const res = await client.issues({
        filter: {
          team: { id: { eq: c.team.id } },
          state: { type: { eq: 'backlog' } },
        },
        first: 50,
      });
      return Promise.all(res.nodes.map(toTask));
    },

    async getInProgress() {
      const c = requireCache();
      const res = await client.issues({
        filter: {
          team: { id: { eq: c.team.id } },
          state: { type: { eq: 'started' } },
        },
        first: 50,
      });
      return Promise.all(res.nodes.map(toTask));
    },

    async getRecentlyDone(sinceISO) {
      const c = requireCache();
      const res = await client.issues({
        filter: {
          team: { id: { eq: c.team.id } },
          state: { type: { eq: 'completed' } },
          completedAt: { gte: sinceISO },
        },
        first: 50,
      });
      return Promise.all(res.nodes.map(toTask));
    },

    formatIssue: formatTask,
  };
}

export { formatTask, priorityCode };
