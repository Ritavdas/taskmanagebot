import { describe, it, expect } from 'vitest';
import { parseDate, shiftDays, todayLocal } from '../src/domain/date.ts';

const TZ = 'Asia/Kolkata';

describe('todayLocal', () => {
  it('returns YYYY-MM-DD', () => {
    expect(todayLocal(TZ)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('shiftDays', () => {
  it('shifts +1 day', () => {
    const today = todayLocal(TZ);
    const tomorrow = shiftDays(TZ, 1);
    expect(tomorrow > today).toBe(true);
  });
  it('shifts -1 day', () => {
    const today = todayLocal(TZ);
    const yesterday = shiftDays(TZ, -1);
    expect(yesterday < today).toBe(true);
  });
});

describe('parseDate', () => {
  it('parses today/tomorrow', () => {
    expect(parseDate(TZ, 'today')).toBe(todayLocal(TZ));
    expect(parseDate(TZ, 'tomorrow')).toBe(shiftDays(TZ, 1));
  });
  it('parses ISO date', () => {
    expect(parseDate(TZ, '2030-01-15')).toBe('2030-01-15');
  });
  it('parses weekday names', () => {
    const result = parseDate(TZ, 'friday');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('parses "in N days"', () => {
    expect(parseDate(TZ, 'in 3 days')).toBe(shiftDays(TZ, 3));
  });
  it('returns null for garbage', () => {
    expect(parseDate(TZ, 'sometime soon')).toBeNull();
  });
  it('is case-insensitive', () => {
    expect(parseDate(TZ, 'TODAY')).toBe(todayLocal(TZ));
  });
});
