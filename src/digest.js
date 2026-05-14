import * as linear from './linear.js';
import * as ai from './ai.js';

export async function buildMorningDigest() {
  const today = new Date().toISOString().slice(0, 10);
  const [overdue, dueToday, inProgress] = await Promise.all([
    linear.getOverdue(),
    linear.getTodayList().then(list => list.filter(i => i.dueDate === today)),
    linear.getInProgress(),
  ]);

  const all = [...inProgress, ...dueToday, ...overdue];
  const seen = new Set();
  const unique = all.filter(i => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });

  const focus = await ai.pickFocus(unique);

  const lines = [`☀️ **good morning.** here's the field.`, ''];

  if (focus.length > 0) {
    lines.push(`**proposed focus** (reply \`yes\` to accept, or \`today X Y\` to override):`);
    for (const f of focus) lines.push(`→ ${await linear.formatIssue(f)}`);
    lines.push('');
  }

  if (overdue.length > 0) {
    lines.push(`**overdue** (${overdue.length})`);
    for (const i of overdue.slice(0, 5)) lines.push(await linear.formatIssue(i));
    if (overdue.length > 5) lines.push(`_+${overdue.length - 5} more_`);
    lines.push('');
  }

  if (inProgress.length > 0) {
    lines.push(`**in progress** (${inProgress.length})`);
    for (const i of inProgress.slice(0, 5)) lines.push(await linear.formatIssue(i));
    lines.push('');
  }

  if (dueToday.length > 0) {
    lines.push(`**due today** (${dueToday.length})`);
    for (const i of dueToday.slice(0, 8)) lines.push(await linear.formatIssue(i));
    lines.push('');
  }

  if (unique.length === 0) {
    lines.push('_nothing on the board. plan something or take the day._');
  }

  lines.push('');
  lines.push('_evening close-out at 10:30 pm._');

  return lines.join('\n');
}
