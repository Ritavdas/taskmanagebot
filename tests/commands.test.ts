import { describe, it, expect } from 'vitest';
import { parseCommand, looksLikeCommand } from '../src/domain/command.ts';

const TZ = 'Asia/Kolkata';

describe('looksLikeCommand', () => {
  it('detects command-keyword prefixes', () => {
    expect(looksLikeCommand('done PER-12')).toBe(true);
    expect(looksLikeCommand('list')).toBe(true);
    expect(looksLikeCommand('help')).toBe(true);
  });
  it('detects ref-prefixed messages', () => {
    expect(looksLikeCommand('PER-12 set priority P1')).toBe(true);
    expect(looksLikeCommand('PER-12 due tomorrow')).toBe(true);
  });
  it('rejects ramble that mentions ref without edit keyword', () => {
    expect(looksLikeCommand('thinking about PER-12 and what it means')).toBe(false);
  });
  it('rejects free-form text', () => {
    expect(looksLikeCommand('I want to write a blog post about react')).toBe(false);
  });
  it('detects project commands', () => {
    expect(looksLikeCommand('projects')).toBe(true);
    expect(looksLikeCommand('project new Friend Catch-ups')).toBe(true);
    expect(looksLikeCommand('create a new project for friend-catch-up tasks')).toBe(true);
    expect(looksLikeCommand('make a project called Vendor Outreach')).toBe(true);
    expect(looksLikeCommand('list projects')).toBe(true);
  });
});

describe('parseCommand', () => {
  it('parses confirm/cancel', () => {
    expect(parseCommand(TZ, 'yes')).toEqual({ ok: true, command: { kind: 'confirm' } });
    expect(parseCommand(TZ, 'y')).toEqual({ ok: true, command: { kind: 'confirm' } });
    expect(parseCommand(TZ, 'no')).toEqual({ ok: true, command: { kind: 'cancel' } });
    expect(parseCommand(TZ, 'cancel')).toEqual({ ok: true, command: { kind: 'cancel' } });
  });

  it('parses help/list/inbox', () => {
    expect(parseCommand(TZ, 'help')).toEqual({ ok: true, command: { kind: 'help' } });
    expect(parseCommand(TZ, 'list')).toEqual({ ok: true, command: { kind: 'list' } });
    expect(parseCommand(TZ, 'inbox')).toEqual({ ok: true, command: { kind: 'inbox' } });
  });

  it('parses done with ref', () => {
    expect(parseCommand(TZ, 'done PER-12')).toEqual({
      ok: true, command: { kind: 'done', ref: 'PER-12' },
    });
  });

  it('parses done with substring', () => {
    expect(parseCommand(TZ, 'done linkedin')).toEqual({
      ok: true, command: { kind: 'done', ref: 'linkedin' },
    });
  });

  it('parses today/plan/drop', () => {
    expect(parseCommand(TZ, 'today PER-1')).toEqual({ ok: true, command: { kind: 'today', ref: 'PER-1' } });
    expect(parseCommand(TZ, 'plan PER-1')).toEqual({ ok: true, command: { kind: 'plan', ref: 'PER-1' } });
    expect(parseCommand(TZ, 'drop PER-1')).toEqual({ ok: true, command: { kind: 'drop', ref: 'PER-1' } });
  });

  it('parses move with date', () => {
    const result = parseCommand(TZ, 'move PER-12 to tomorrow');
    expect(result.ok).toBe(true);
    if (result.ok && result.command.kind === 'move') {
      expect(result.command.ref).toBe('PER-12');
      expect(result.command.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('rejects move with bad date', () => {
    const result = parseCommand(TZ, 'move PER-12 to whenever');
    expect(result.ok).toBe(false);
  });

  it('parses priority forms', () => {
    expect(parseCommand(TZ, 'priority PER-12 P1')).toEqual({
      ok: true, command: { kind: 'priority', ref: 'PER-12', priority: 'P1' },
    });
    expect(parseCommand(TZ, 'p0 PER-12')).toEqual({
      ok: true, command: { kind: 'priority', ref: 'PER-12', priority: 'P0' },
    });
    expect(parseCommand(TZ, 'prio PER-12 urgent')).toEqual({
      ok: true, command: { kind: 'priority', ref: 'PER-12', priority: 'P0' },
    });
  });

  it('parses blocked with and without reason', () => {
    expect(parseCommand(TZ, 'blocked PER-12 because waiting on Tushar')).toEqual({
      ok: true,
      command: { kind: 'blocked', ref: 'PER-12', reason: 'waiting on Tushar' },
    });
    expect(parseCommand(TZ, 'blocked PER-12')).toEqual({
      ok: true,
      command: { kind: 'blocked', ref: 'PER-12', reason: null },
    });
  });

  it('parses add', () => {
    expect(parseCommand(TZ, 'add fix the bug')).toEqual({
      ok: true, command: { kind: 'add', text: 'fix the bug' },
    });
  });

  it('parses ref-prefixed edit as edit command', () => {
    const result = parseCommand(TZ, 'PER-12 set priority P1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.kind).toBe('edit');
      if (result.command.kind === 'edit') {
        expect(result.command.ref).toBe('PER-12');
        expect(result.command.raw).toBe('PER-12 set priority P1');
      }
    }
  });

  it('rejects ref with no edit keyword', () => {
    const result = parseCommand(TZ, 'PER-12 hello');
    expect(result.ok).toBe(false);
  });

  it('rejects multiple refs', () => {
    const result = parseCommand(TZ, 'PER-12 set priority PER-13');
    expect(result.ok).toBe(false);
  });

  it('rejects unknown input', () => {
    const result = parseCommand(TZ, 'gibberish');
    expect(result.ok).toBe(false);
  });

  it('parses explicit project commands', () => {
    expect(parseCommand(TZ, 'projects')).toEqual({
      ok: true, command: { kind: 'project_list' },
    });
    expect(parseCommand(TZ, 'project list')).toEqual({
      ok: true, command: { kind: 'project_list' },
    });
    expect(parseCommand(TZ, 'project new Friend Catch-ups')).toEqual({
      ok: true, command: { kind: 'project_new', name: 'Friend Catch-ups' },
    });
  });

  it('parses natural-language project creation', () => {
    expect(parseCommand(TZ, 'create a new project for friend-catch-up tasks')).toEqual({
      ok: true, command: { kind: 'project_new', name: 'friend-catch-up' },
    });
    expect(parseCommand(TZ, 'make a project called Vendor Outreach')).toEqual({
      ok: true, command: { kind: 'project_new', name: 'Vendor Outreach' },
    });
    expect(parseCommand(TZ, 'new project: Side Hustles')).toEqual({
      ok: true, command: { kind: 'project_new', name: 'Side Hustles' },
    });
  });

  it('parses natural-language project listing', () => {
    expect(parseCommand(TZ, 'list all projects')).toEqual({
      ok: true, command: { kind: 'project_list' },
    });
    expect(parseCommand(TZ, 'show projects')).toEqual({
      ok: true, command: { kind: 'project_list' },
    });
  });

  it('parses project refresh', () => {
    expect(parseCommand(TZ, 'refresh projects')).toEqual({
      ok: true, command: { kind: 'project_refresh' },
    });
    expect(parseCommand(TZ, 'projects refresh')).toEqual({
      ok: true, command: { kind: 'project_refresh' },
    });
    expect(parseCommand(TZ, 'sync projects')).toEqual({
      ok: true, command: { kind: 'project_refresh' },
    });
  });
});
