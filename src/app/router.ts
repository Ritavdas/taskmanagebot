import { parseCommand } from '../domain/command.ts';
import type { LinearAdapter } from '../infra/linear.ts';
import type { AIAdapter } from '../infra/ai.ts';
import { handleCommand, type Reply } from './commands.ts';
import { PendingEditsStore } from './pending-edits.ts';

interface Deps {
  linear: LinearAdapter;
  ai: AIAdapter;
  timezone: string;
}

export function createRouter(deps: Deps) {
  const pendingEdits = new PendingEditsStore();
  const handlerDeps = { linear: deps.linear, ai: deps.ai, pendingEdits };

  return async function routeMessage(text: string, reply: Reply): Promise<void> {
    const intent = await deps.ai.routeIntent(text);
    console.log(`[msg] intent=${intent} text="${text.slice(0, 80)}"`);

    if (intent === 'command') {
      const result = parseCommand(deps.timezone, text);
      if (!result.ok) return reply(result.reason);
      return handleCommand(result.command, reply, handlerDeps);
    }

    if (intent === 'single_task') {
      const result = parseCommand(deps.timezone, `add ${text}`);
      if (!result.ok) return reply(result.reason);
      return handleCommand(result.command, reply, handlerDeps);
    }

    if (intent === 'dump') {
      const { tasks, thoughts } = await deps.ai.parseTasks(text);
      if (tasks.length === 0) {
        await reply(`couldn't pull clear actions out of that. ${thoughts.length ? 'noted as thoughts.' : ''}`);
        return;
      }
      const lines: string[] = [`extracted ${tasks.length} task${tasks.length > 1 ? 's' : ''}:`];
      for (const t of tasks) {
        const dueSuffix = t.dueDate ? ` · due ${t.dueDate}` : '';
        lines.push(`• **${t.title}** _(${t.area ?? 'no area'}${dueSuffix})_`);
      }
      if (thoughts.length > 0) {
        lines.push('', `_kept as thoughts (not added):_`);
        for (const t of thoughts) lines.push(`💭 ${t}`);
      }
      lines.push('', 'creating these now...');
      await reply(lines.join('\n'));

      const created: string[] = [];
      for (const t of tasks) {
        const issue = await deps.linear.createIssue(t);
        created.push(deps.linear.formatIssue(issue));
      }
      await reply(`✅ added:\n${created.join('\n')}`);
      return;
    }

    const response = await deps.ai.chat(text);
    await reply(response);
  };
}
