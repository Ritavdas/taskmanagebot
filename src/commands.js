import * as linear from './linear.js';
import * as ai from './ai.js';

const DATE_WORDS = {
  today: () => new Date(),
  tomorrow: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; },
  monday: () => nextWeekday(1),
  tuesday: () => nextWeekday(2),
  wednesday: () => nextWeekday(3),
  thursday: () => nextWeekday(4),
  friday: () => nextWeekday(5),
  saturday: () => nextWeekday(6),
  sunday: () => nextWeekday(0),
};

function nextWeekday(target) {
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function parseDate(str) {
  const lower = str.trim().toLowerCase();
  if (DATE_WORDS[lower]) return DATE_WORDS[lower]().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;
  const m = lower.match(/^in (\d+) days?$/);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(m[1], 10));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function mentionedIssueRef(text) {
  return text.match(/\b[A-Z0-9]+-\d+\b/i)?.[0] || null;
}

async function resolveIssue(ref) {
  const result = await linear.findIssue(ref);
  if (!result) return { error: `couldn't find anything matching "${ref}".` };
  if (Array.isArray(result)) {
    if (result.length === 0) return { error: `no active task matches "${ref}".` };
    if (result.length === 1) return { issue: result[0] };
    const list = await Promise.all(result.slice(0, 5).map(linear.formatIssue));
    return { error: `multiple matches for "${ref}":\n${list.join('\n')}\nReply with the identifier (e.g., \`done PER-12\`).` };
  }
  return { issue: result };
}

export async function handleCommand(text, replyFn) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (/^help\b/i.test(trimmed)) {
    return replyFn([
      '**commands**',
      '`add <description>` — capture a task',
      '`add P0 <description>` — capture with priority',
      '`done <ref>` — complete it',
      '`today <ref>` — pull into today',
      '`plan <ref>` — move from inbox to planned',
      '`move <ref> to <date>` — reschedule',
      '`priority <ref> P1` — set priority (P0 urgent, P1 high, P2 normal, P3 low, P4 none)',
      '`blocked <ref> because <reason>` — mark blocked',
      '`drop <ref>` — cancel',
      '`list` — today\'s tasks',
      '`inbox` — triage queue',
      '',
      '_or just dump thoughts and I\'ll triage them._',
    ].join('\n'));
  }

  if (/^list\b/i.test(trimmed)) {
    const issues = await linear.getTodayList();
    if (issues.length === 0) return replyFn('🌱 nothing on today\'s list. add something or rest.');
    const lines = await Promise.all(issues.map(linear.formatIssue));
    return replyFn(`**today / due / in progress** (${issues.length})\n${lines.join('\n')}`);
  }

  if (/^inbox\b/i.test(trimmed)) {
    const issues = await linear.getInbox();
    if (issues.length === 0) return replyFn('📭 inbox is empty.');
    const lines = await Promise.all(issues.slice(0, 20).map(linear.formatIssue));
    return replyFn(`**inbox** (${issues.length})\n${lines.join('\n')}`);
  }

  const issueRef = mentionedIssueRef(trimmed);
  if (issueRef && !/^(done|today|plan|move|blocked|drop|priority|prio|p[0-4])\b/i.test(trimmed)) {
    const { issue, error } = await resolveIssue(issueRef);
    if (error) return replyFn(error);

    const { fields } = await ai.parseIssueEdit(trimmed);
    const updates = {};
    if (fields.title !== null && fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== null && fields.description !== undefined) updates.description = fields.description;
    if (fields.dueDate !== undefined) updates.dueDate = fields.dueDate;
    if (fields.priority !== null && fields.priority !== undefined) updates.priority = fields.priority;

    if (Object.keys(updates).length === 0) {
      return replyFn(`I found \`${issue.identifier}\`, but couldn't tell what to edit. Try: \`priority ${issue.identifier} P1\`, \`move ${issue.identifier} to tomorrow\`, or \`${issue.identifier} description <text>\`.`);
    }

    await linear.updateIssueFields(issue.id, updates);
    const updatedIssue = await linear.findIssue(issue.identifier);
    return replyFn(`✏️ updated ${await linear.formatIssue(updatedIssue)}`);
  }

  let m = trimmed.match(/^add\s+(.+)/is);
  if (m) {
    const desc = m[1];
    const { tasks } = await ai.parseTasks(desc);
    if (tasks.length === 0) {
      return replyFn(`couldn't pull a clear action out of that. try rephrasing as an imperative ("call mom", "fix X", "draft Y").`);
    }
    const created = [];
    for (const t of tasks) {
      const issue = await linear.createIssue(t);
      created.push(await linear.formatIssue(issue));
    }
    return replyFn(`✅ added ${created.length}:\n${created.join('\n')}`);
  }

  m = trimmed.match(/^done\s+(.+)/i);
  if (m) {
    const { issue, error } = await resolveIssue(m[1]);
    if (error) return replyFn(error);
    await linear.markDone(issue.id);
    return replyFn(`✓ done · \`${issue.identifier}\` ${issue.title}`);
  }

  m = trimmed.match(/^today\s+(.+)/i);
  if (m) {
    const { issue, error } = await resolveIssue(m[1]);
    if (error) return replyFn(error);
    await linear.moveToToday(issue.id);
    return replyFn(`☀️ pulled into today · \`${issue.identifier}\` ${issue.title}`);
  }

  m = trimmed.match(/^(?:priority|prio)\s+(.+?)\s+(p[0-4]|urgent|high|normal|medium|low|none|no priority)$/i);
  if (m) {
    const { issue, error } = await resolveIssue(m[1]);
    if (error) return replyFn(error);
    await linear.setPriority(issue.id, m[2]);
    return replyFn(`🚦 set ${linear.priorityCode(m[2])} · \`${issue.identifier}\` ${issue.title}`);
  }

  m = trimmed.match(/^(p[0-4])\s+(.+)/i);
  if (m) {
    const { issue, error } = await resolveIssue(m[2]);
    if (error) return replyFn(error);
    await linear.setPriority(issue.id, m[1]);
    return replyFn(`🚦 set ${linear.priorityCode(m[1])} · \`${issue.identifier}\` ${issue.title}`);
  }

  m = trimmed.match(/^plan\s+(.+)/i);
  if (m) {
    const { issue, error } = await resolveIssue(m[1]);
    if (error) return replyFn(error);
    await linear.setState(issue.id, 'todo');
    return replyFn(`📋 planned · \`${issue.identifier}\` ${issue.title}`);
  }

  m = trimmed.match(/^move\s+(.+?)\s+to\s+(.+)/i);
  if (m) {
    const date = parseDate(m[2]);
    if (!date) return replyFn(`don't know that date: "${m[2]}". try YYYY-MM-DD, today, tomorrow, friday, or "in 3 days".`);
    const { issue, error } = await resolveIssue(m[1]);
    if (error) return replyFn(error);
    await linear.setDueDate(issue.id, date);
    return replyFn(`📅 moved \`${issue.identifier}\` to ${date}`);
  }

  m = trimmed.match(/^blocked\s+(.+?)(?:\s+because\s+(.+))?$/i);
  if (m) {
    const { issue, error } = await resolveIssue(m[1]);
    if (error) return replyFn(error);
    await linear.markBlocked(issue.id, m[2] || '');
    return replyFn(`🚧 blocked · \`${issue.identifier}\` ${issue.title}${m[2] ? ` — ${m[2]}` : ''}`);
  }

  m = trimmed.match(/^drop\s+(.+)/i);
  if (m) {
    const { issue, error } = await resolveIssue(m[1]);
    if (error) return replyFn(error);
    await linear.markDropped(issue.id);
    return replyFn(`🗑️ dropped · \`${issue.identifier}\` ${issue.title}`);
  }

  if (/^(yes|y|no|n|cancel)$/i.test(lower)) {
    return replyFn('nothing pending to confirm.');
  }

  return replyFn(`didn't recognize that command. type \`help\` for options.`);
}
