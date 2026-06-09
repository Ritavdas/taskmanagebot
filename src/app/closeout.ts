import type { LinearAdapter } from '../infra/linear.ts';
import { withRetry } from '../infra/retry.ts';

export async function buildEveningCloseout(linear: LinearAdapter): Promise<string> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sinceISO = startOfDay.toISOString();

  const warn = (label: string) => (err: unknown, attempt: number) =>
    console.warn(`closeout: ${label} failed (retry ${attempt}):`, (err as Error).message);

  const [todayRes, doneRes] = await Promise.allSettled([
    withRetry(() => linear.getTodayList(), { onRetry: warn('getTodayList') }),
    withRetry(() => linear.getRecentlyDone(sinceISO), { onRetry: warn('getRecentlyDone') }),
  ]);

  const todayList = todayRes.status === 'fulfilled' ? todayRes.value : null;
  const doneToday = doneRes.status === 'fulfilled' ? doneRes.value : null;

  // Both Linear queries failed even after retries — nothing to render.
  if (todayList === null && doneToday === null) {
    throw new Error('Linear is unreachable right now — both close-out queries failed.');
  }

  const lines: string[] = [`🌙 **close-out time.** how did the day go?`, ''];

  const done = doneToday ?? [];
  if (done.length > 0) {
    lines.push(`**closed today** (${done.length}) — nice.`);
    for (const t of done.slice(0, 8)) lines.push(`✓ ${linear.formatIssue(t)}`);
    lines.push('');
  }

  if (todayList === null) {
    lines.push("_couldn't reach Linear for your open list (it hiccuped). will retry tomorrow._");
    return lines.join('\n');
  }

  const open = todayList.filter(t => !done.find(d => d.id === t.id));
  if (open.length > 0) {
    lines.push(`**still open** (${open.length}) — what's the call?`);
    for (const t of open.slice(0, 10)) lines.push(`• ${linear.formatIssue(t)}`);
    lines.push('');
    lines.push('reply with:');
    lines.push('`done PER-12` · `move PER-12 to tomorrow` · `blocked PER-12 because ...` · `drop PER-12`');
  } else if (done.length > 0) {
    lines.push('_clean slate. log off._');
  } else {
    lines.push('_no movement today. tomorrow is a fresh page._');
  }

  return lines.join('\n');
}
