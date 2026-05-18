import { describe, it, expect } from 'vitest';
import { parsePriority, priorityToLinearNumber, priorityFromLinearNumber } from '../src/domain/task.ts';

describe('parsePriority', () => {
  it('parses canonical codes', () => {
    expect(parsePriority('P0')).toBe('P0');
    expect(parsePriority('P4')).toBe('P4');
  });
  it('parses aliases', () => {
    expect(parsePriority('urgent')).toBe('P0');
    expect(parsePriority('high')).toBe('P1');
    expect(parsePriority('normal')).toBe('P2');
    expect(parsePriority('low')).toBe('P3');
    expect(parsePriority('none')).toBe('P4');
  });
  it('is case-insensitive', () => {
    expect(parsePriority('p1')).toBe('P1');
    expect(parsePriority('URGENT')).toBe('P0');
  });
  it('parses numbers', () => {
    expect(parsePriority(1)).toBe('P0');
    expect(parsePriority(0)).toBe('P4');
  });
  it('returns undefined for empty/null', () => {
    expect(parsePriority(null)).toBeUndefined();
    expect(parsePriority(undefined)).toBeUndefined();
    expect(parsePriority('')).toBeUndefined();
  });
  it('throws on garbage', () => {
    expect(() => parsePriority('asdf')).toThrow();
    expect(() => parsePriority(99)).toThrow();
  });
});

describe('priority<->Linear number round-trip', () => {
  it('round-trips P0..P4', () => {
    for (const code of ['P0', 'P1', 'P2', 'P3', 'P4'] as const) {
      const num = priorityToLinearNumber(code);
      expect(priorityFromLinearNumber(num)).toBe(code);
    }
  });
});
