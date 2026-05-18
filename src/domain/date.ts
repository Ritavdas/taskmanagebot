export function todayLocal(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function shiftDays(timezone: string, n: number): string {
  const parts = todayLocal(timezone).split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function nextWeekday(timezone: string, target: number): string {
  const parts = todayLocal(timezone).split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const diff = (target - dt.getUTCDay() + 7) % 7 || 7;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

export function parseDate(timezone: string, input: string): string | null {
  const lower = input.trim().toLowerCase();
  if (lower === 'today') return todayLocal(timezone);
  if (lower === 'tomorrow') return shiftDays(timezone, 1);
  const wd = WEEKDAYS[lower];
  if (wd !== undefined) return nextWeekday(timezone, wd);
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;
  const m = lower.match(/^in (\d+) days?$/);
  if (m?.[1]) return shiftDays(timezone, parseInt(m[1], 10));
  return null;
}
