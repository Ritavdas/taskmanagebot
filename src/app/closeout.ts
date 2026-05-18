import type { LinearAdapter } from '../infra/linear.ts';

export async function buildEveningCloseout(linear: LinearAdapter): Promise<string> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sinceISO = startOfDay.toISOString();

  const [todayList, doneToday] = await Promise.all([
    linear.getTodayList(),
    linear.getRecentlyDone(sinceISO),
  ]);

  const lines: string[] = [`🌙 **close-out time.** how did the day go?`, ''];

  if (doneToday.length > 0) {
    lines.push(`**closed today** (${doneToday.length}) — nice.`);
    for (const t of doneToday.slice(0, 8)) lines.push(`✓ ${linear.formatIssue(t)}`);
    lines.push('');
  }

  const open = todayList.filter(t => !doneToday.find(d => d.id === t.id));
  if (open.length > 0) {
    lines.push(`**still open** (${open.length}) — what's the call?`);
    for (const t of open.slice(0, 10)) lines.push(`• ${linear.formatIssue(t)}`);
    lines.push('');
    lines.push('reply with:');
    lines.push('`done PER-12` · `move PER-12 to tomorrow` · `blocked PER-12 because ...` · `drop PER-12`');
  } else if (doneToday.length > 0) {
    lines.push('_clean slate. log off._');
  } else {
    lines.push('_no movement today. tomorrow is a fresh page._');
  }

  return lines.join('\n');
}
