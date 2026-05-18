import type { PriorityCode } from './task.ts';
import { parsePriority } from './task.ts';
import { parseDate } from './date.ts';

export type Command =
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'inbox' }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'add'; text: string }
  | { kind: 'done'; ref: string }
  | { kind: 'today'; ref: string }
  | { kind: 'plan'; ref: string }
  | { kind: 'move'; ref: string; due: string }
  | { kind: 'priority'; ref: string; priority: PriorityCode }
  | { kind: 'blocked'; ref: string; reason: string | null }
  | { kind: 'drop'; ref: string }
  | { kind: 'edit'; ref: string; raw: string };

export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; reason: string };

const ISSUE_REF = /\b[A-Z][A-Z0-9]*-\d+\b/;
const STARTS_WITH_REF = /^[A-Z][A-Z0-9]*-\d+\b/;
const EDIT_KEYWORDS = /\b(change|set|update|make|rename|edit|move|due|priority|prio|description|desc|details|notes|context|deadline|title|clear|remove|delete|unset|today|tomorrow|p[0-4])\b/i;
const COMMAND_KEYWORD = /^(done|move|priority|prio|p[0-4]|blocked|drop|add|today|plan|list|inbox|yes|no|cancel|y|n|help)\b/i;

/** Heuristic for whether `text` looks like an issued command (not a brain-dump). */
export function looksLikeCommand(text: string): boolean {
  const t = text.trim();
  if (ISSUE_REF.test(t) && (STARTS_WITH_REF.test(t) || EDIT_KEYWORDS.test(t))) return true;
  return COMMAND_KEYWORD.test(t);
}

export function parseCommand(timezone: string, raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty input' };

  if (/^(yes|y)$/i.test(text)) return { ok: true, command: { kind: 'confirm' } };
  if (/^(no|n|cancel)$/i.test(text)) return { ok: true, command: { kind: 'cancel' } };
  if (/^help\b/i.test(text)) return { ok: true, command: { kind: 'help' } };
  if (/^list\b/i.test(text)) return { ok: true, command: { kind: 'list' } };
  if (/^inbox\b/i.test(text)) return { ok: true, command: { kind: 'inbox' } };

  if (STARTS_WITH_REF.test(text)) {
    const refMatch = text.match(ISSUE_REF);
    if (refMatch) {
      const ref = refMatch[0];
      const all = [...text.matchAll(/\b[A-Z][A-Z0-9]*-\d+\b/g)];
      if (all.length > 1) {
        return { ok: false, reason: `found multiple issue refs (${all.map(m => m[0]).join(', ')}). edit one at a time, e.g. \`${ref} <change>\`.` };
      }
      if (!EDIT_KEYWORDS.test(text)) {
        return { ok: false, reason: `saw \`${ref}\` but no edit keyword. say e.g. \`${ref} set priority P1\` or \`${ref} description <text>\`.` };
      }
      return { ok: true, command: { kind: 'edit', ref, raw: text } };
    }
  }

  let m = text.match(/^add\s+(.+)/is);
  if (m?.[1]) return { ok: true, command: { kind: 'add', text: m[1] } };

  m = text.match(/^done\s+(.+)/i);
  if (m?.[1]) return { ok: true, command: { kind: 'done', ref: m[1].trim() } };

  m = text.match(/^today\s+(.+)/i);
  if (m?.[1]) return { ok: true, command: { kind: 'today', ref: m[1].trim() } };

  m = text.match(/^plan\s+(.+)/i);
  if (m?.[1]) return { ok: true, command: { kind: 'plan', ref: m[1].trim() } };

  m = text.match(/^move\s+(.+?)\s+to\s+(.+)/i);
  if (m?.[1] && m[2]) {
    const due = parseDate(timezone, m[2]);
    if (!due) return { ok: false, reason: `don't know that date: "${m[2]}". try YYYY-MM-DD, today, tomorrow, friday, or "in 3 days".` };
    return { ok: true, command: { kind: 'move', ref: m[1].trim(), due } };
  }

  m = text.match(/^(?:priority|prio)\s+(.+?)\s+(p[0-4]|urgent|high|normal|medium|low|none|no priority)$/i);
  if (m?.[1] && m[2]) {
    try {
      const priority = parsePriority(m[2]);
      if (priority) return { ok: true, command: { kind: 'priority', ref: m[1].trim(), priority } };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  m = text.match(/^(p[0-4])\s+(.+)/i);
  if (m?.[1] && m[2]) {
    try {
      const priority = parsePriority(m[1]);
      if (priority) return { ok: true, command: { kind: 'priority', ref: m[2].trim(), priority } };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  m = text.match(/^blocked\s+(.+?)(?:\s+because\s+(.+))?$/i);
  if (m?.[1]) {
    return { ok: true, command: { kind: 'blocked', ref: m[1].trim(), reason: m[2]?.trim() ?? null } };
  }

  m = text.match(/^drop\s+(.+)/i);
  if (m?.[1]) return { ok: true, command: { kind: 'drop', ref: m[1].trim() } };

  return { ok: false, reason: 'didn\'t recognize that command. type `help` for options.' };
}
