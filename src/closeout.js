import * as linear from './linear.js';

export async function buildEveningCloseout() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sinceISO = startOfDay.toISOString();

  const [todayList, doneToday] = await Promise.all([
    linear.getTodayList(),
    linear.getRecentlyDone(sinceISO),
  ]);

  const lines = [`🌙 **close-out time.** how did the day go?`, ''];

  if (doneToday.length > 0) {
    lines.push(`**closed today** (${doneToday.length}) — nice.`);
    for (const i of doneToday.slice(0, 8)) lines.push(`✓ ${await linear.formatIssue(i)}`);
    lines.push('');
  }

  const open = todayList.filter(i => !doneToday.find(d => d.id === i.id));
  if (open.length > 0) {
    lines.push(`**still open** (${open.length}) — what's the call?`);
    for (const i of open.slice(0, 10)) lines.push(`• ${await linear.formatIssue(i)}`);
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
