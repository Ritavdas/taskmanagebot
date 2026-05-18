import type { Command } from '../domain/command.ts';
import type { Task, PriorityCode } from '../domain/task.ts';
import type { LinearAdapter, IssueUpdateFields, FindIssueResult } from '../infra/linear.ts';
import type { AIAdapter } from '../infra/ai.ts';
import type { PendingEditsStore } from './pending-edits.ts';

export type Reply = (content: string) => Promise<void>;

interface Deps {
  linear: LinearAdapter;
  ai: AIAdapter;
  pendingEdits: PendingEditsStore;
}

async function resolveIssue(linear: LinearAdapter, ref: string): Promise<{ task?: Task; error?: string }> {
  const result: FindIssueResult = await linear.findIssue(ref);
  if (result.exact) return { task: result.exact };
  const matches = result.matches ?? [];
  if (matches.length === 0) return { error: `couldn't find anything matching "${ref}".` };
  if (matches.length === 1 && matches[0]) return { task: matches[0] };
  const list = matches.slice(0, 5).map(t => linear.formatIssue(t)).join('\n');
  return { error: `multiple matches for "${ref}":\n${list}\nReply with the identifier (e.g., \`done PER-12\`).` };
}

function summarizeUpdates(updates: IssueUpdateFields): string {
  return Object.entries(updates).map(([k, v]) => {
    let val: string;
    if (v === null) val = '(cleared)';
    else if (typeof v === 'string' && v.length > 80) val = v.slice(0, 80) + '…';
    else val = String(v);
    return `• ${k}: ${val}`;
  }).join('\n');
}

const HELP_TEXT = [
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
].join('\n');

export async function handleCommand(command: Command, reply: Reply, deps: Deps): Promise<void> {
  const { linear, ai, pendingEdits } = deps;

  switch (command.kind) {
    case 'confirm': {
      const pending = pendingEdits.take();
      if (!pending) return reply('nothing pending to confirm.');
      const updated = await linear.updateIssue(pending.issueId, pending.updates);
      return reply(`✏️ updated ${linear.formatIssue(updated)}`);
    }

    case 'cancel': {
      const had = pendingEdits.clear();
      return reply(had ? 'cancelled.' : 'nothing pending to confirm.');
    }

    case 'help':
      return reply(HELP_TEXT);

    case 'list': {
      const tasks = await linear.getTodayList();
      if (tasks.length === 0) return reply('🌱 nothing on today\'s list. add something or rest.');
      const lines = tasks.map(t => linear.formatIssue(t)).join('\n');
      return reply(`**today / due / in progress** (${tasks.length})\n${lines}`);
    }

    case 'inbox': {
      const tasks = await linear.getInbox();
      if (tasks.length === 0) return reply('📭 inbox is empty.');
      const lines = tasks.slice(0, 20).map(t => linear.formatIssue(t)).join('\n');
      return reply(`**inbox** (${tasks.length})\n${lines}`);
    }

    case 'add': {
      const { tasks } = await ai.parseTasks(command.text);
      if (tasks.length === 0) {
        return reply(`couldn't pull a clear action out of that. try rephrasing as an imperative ("call mom", "fix X", "draft Y").`);
      }
      const created: string[] = [];
      for (const t of tasks) {
        const issue = await linear.createIssue(t);
        created.push(linear.formatIssue(issue));
      }
      return reply(`✅ added ${created.length}:\n${created.join('\n')}`);
    }

    case 'done': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');
      await linear.markDone(task.id);
      return reply(`✓ done · \`${task.identifier}\` ${task.title}`);
    }

    case 'today': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');
      await linear.moveToToday(task.id);
      return reply(`☀️ pulled into today · \`${task.identifier}\` ${task.title}`);
    }

    case 'plan': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');
      await linear.setState(task.id, 'todo');
      return reply(`📋 planned · \`${task.identifier}\` ${task.title}`);
    }

    case 'move': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');
      await linear.setDueDate(task.id, command.due);
      return reply(`📅 moved \`${task.identifier}\` to ${command.due}`);
    }

    case 'priority': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');
      await linear.setPriority(task.id, command.priority);
      return reply(`🚦 set ${command.priority} · \`${task.identifier}\` ${task.title}`);
    }

    case 'blocked': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');
      await linear.markBlocked(task.id, command.reason);
      const suffix = command.reason ? ` — ${command.reason}` : '';
      return reply(`🚧 blocked · \`${task.identifier}\` ${task.title}${suffix}`);
    }

    case 'drop': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');
      await linear.markDropped(task.id);
      return reply(`🗑️ dropped · \`${task.identifier}\` ${task.title}`);
    }

    case 'edit': {
      const { task, error } = await resolveIssue(linear, command.ref);
      if (error || !task) return reply(error ?? 'not found');

      const { fields } = await ai.parseIssueEdit(command.raw);
      const updates: IssueUpdateFields = {};
      if (fields.title !== undefined) updates.title = fields.title;
      if (fields.description !== undefined) updates.description = fields.description;
      if (fields.dueDate !== undefined) updates.dueDate = fields.dueDate;
      if (fields.priority !== undefined) updates.priority = fields.priority as PriorityCode;

      if (Object.keys(updates).length === 0) {
        return reply(`I found \`${task.identifier}\`, but couldn't tell what to edit. Try: \`priority ${task.identifier} P1\`, \`move ${task.identifier} to tomorrow\`, or \`${task.identifier} description <text>\`.`);
      }

      pendingEdits.set({ issueId: task.id, identifier: task.identifier, updates });
      return reply(`✏️ edit \`${task.identifier}\` ${task.title}?\n${summarizeUpdates(updates)}\nreply \`yes\` to confirm or \`no\` to cancel.`);
    }

    default: {
      const _exhaustive: never = command;
      throw new Error(`Unhandled command: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
