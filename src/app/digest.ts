import type { LinearAdapter } from '../infra/linear.ts';
import type { AIAdapter } from '../infra/ai.ts';
import { todayLocal } from '../domain/date.ts';

export async function buildMorningDigest(linear: LinearAdapter, ai: AIAdapter, timezone: string): Promise<string> {
  const today = todayLocal(timezone);
  const [overdue, todayList, inProgress] = await Promise.all([
    linear.getOverdue(),
    linear.getTodayList(),
    linear.getInProgress(),
  ]);
  const dueToday = todayList.filter(t => t.dueDate === today);

  const seen = new Set<string>();
  const unique = [...inProgress, ...dueToday, ...overdue].filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  const focus = await ai.pickFocus(unique);

  const lines: string[] = [`☀️ **good morning.** here's the field.`, ''];

  if (focus.length > 0) {
    lines.push(`**proposed focus** (reply \`yes\` to accept, or \`today X Y\` to override):`);
    for (const f of focus) lines.push(`→ ${linear.formatIssue(f)}`);
    lines.push('');
  }

  if (overdue.length > 0) {
    lines.push(`**overdue** (${overdue.length})`);
    for (const t of overdue.slice(0, 5)) lines.push(linear.formatIssue(t));
    if (overdue.length > 5) lines.push(`_+${overdue.length - 5} more_`);
    lines.push('');
  }

  if (inProgress.length > 0) {
    lines.push(`**in progress** (${inProgress.length})`);
    for (const t of inProgress.slice(0, 5)) lines.push(linear.formatIssue(t));
    lines.push('');
  }

  if (dueToday.length > 0) {
    lines.push(`**due today** (${dueToday.length})`);
    for (const t of dueToday.slice(0, 8)) lines.push(linear.formatIssue(t));
    lines.push('');
  }

  if (unique.length === 0) {
    lines.push('_nothing on the board. plan something or take the day._');
  }

  lines.push('');
  lines.push('_evening close-out at 10:30 pm._');
  return lines.join('\n');
}
