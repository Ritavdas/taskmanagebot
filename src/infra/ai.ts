import { createOpenAI } from '@ai-sdk/openai';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { PriorityCodeSchema, type Task } from '../domain/task.ts';
import { todayLocal } from '../domain/date.ts';

export type Intent = 'command' | 'dump' | 'single_task' | 'chitchat';

const ParseTasksOutputSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().min(1).max(120),
    area: z.string().nullable(),
    priority: PriorityCodeSchema.nullable(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    context: z.string().nullable(),
  })),
  thoughts: z.array(z.string()).default([]),
});
export type ParsedTasks = z.infer<typeof ParseTasksOutputSchema>;

/**
 * Best-effort repair for malformed/truncated JSON from weaker models.
 * Strips code fences, closes unterminated strings/brackets, and removes
 * trailing commas so generateObject can recover instead of throwing.
 */
function repairJsonText({ text }: { text: string }): Promise<string | null> {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start < 0) return Promise.resolve(null);
  s = s.slice(start);

  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') closers.pop();
  }

  let out = s;
  if (inString) out += '"';
  out = out.replace(/[,\s]+$/, '');
  out = out.replace(/:\s*$/, ': null');
  for (let i = closers.length - 1; i >= 0; i--) out += closers[i];
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return Promise.resolve(out);
}

const IssueEditFieldsSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: PriorityCodeSchema.optional(),
});
const IssueEditOutputSchema = z.object({
  issueRef: z.string().nullable(),
  fields: IssueEditFieldsSchema,
});
export type IssueEditFields = z.infer<typeof IssueEditFieldsSchema>;
export type IssueEditOutput = z.infer<typeof IssueEditOutputSchema>;

const INTENT_VALUES = ['command', 'dump', 'single_task', 'chitchat'] as const;
const IntentSchema = z.enum(INTENT_VALUES);

const PARSE_TASK_PROMPT_HEADER = `You are the parser layer of a personal task OS for Ritav Das, a software engineer at Microsoft Hyderabad.

Your job: take a freeform brain dump and extract concrete next actions.`;

const PARSE_TASK_PROMPT_RULES = `Rules:
1. Only extract things that are clear next actions. Vague thoughts/feelings → skip them.
2. Each task needs a short imperative title (max 10 words), a single area (must be exactly one of the area names above, or null if none fit), optional priority, and optional dueDate (YYYY-MM-DD) if stated.
3. If user mentions "today" → dueDate is today. "tomorrow" → tomorrow. "friday" → next friday. "next week" → leave dueDate null.
4. If something is just a thought, idea, or feeling without an action → put it in "thoughts" array, not "tasks".
5. Professional work tasks must be sanitized — no internal Microsoft/Azure project names, no customer details, no confidential info. Generalize them.
6. Priority mapping: P0/urgent/critical → "P0"; P1/high/important → "P1"; P2/normal/default → "P2"; P3/low/someday → "P3"; no stated priority → null.`;

function buildParseTaskPrompt(areas: string[]): string {
  return `${PARSE_TASK_PROMPT_HEADER}

Areas (pick exactly one per task, or null if nothing fits):
${areas.map(a => `- ${a}`).join('\n')}

${PARSE_TASK_PROMPT_RULES}`;
}

const ROUTE_INTENT_PROMPT = `You are the intent router for a personal task bot. Classify the user's message into ONE intent.

Intents:
- "command": user is issuing a structured command like done/move/priority/blocked/drop/add/today/plan/list/inbox/yes/no/cancel
- "dump": user is brain-dumping multiple thoughts/tasks to triage
- "single_task": user is describing one task to add
- "chitchat": user is just chatting, asking a question, saying hi, etc.

Respond with ONLY the intent word.`;

const EDIT_ISSUE_PROMPT = `You parse edits to an existing Linear issue.

Supported fields:
- dueDate: YYYY-MM-DD or null if the user explicitly asks to remove/clear the due date
- priority: "P0", "P1", "P2", "P3", "P4"
- description: string if the user asks to update/change/set/add description/details/notes/context
- title: string if the user asks to rename/change title

Rules:
1. Extract exactly one issueRef from the message, e.g. RIT2-12.
2. If the user says "due tomorrow", "move to friday", "set deadline today", output dueDate.
3. Priority mapping: P0/urgent/critical → "P0"; P1/high/important → "P1"; P2/normal/default → "P2"; P3/low → "P3"; P4/none/no priority → "P4".
4. For description, use the exact useful content after words like "description", "desc", "details", "notes", "context", "because", or "to".
5. Do not invent missing fields.
6. Omit fields that are not being updated. Only use null for dueDate when the user explicitly asks to clear/remove the due date.`;

export interface AIAdapter {
  routeIntent(message: string): Promise<Intent>;
  parseTasks(text: string): Promise<ParsedTasks>;
  parseIssueEdit(text: string): Promise<IssueEditOutput>;
  chat(message: string): Promise<string>;
  pickFocus(tasks: Task[]): Promise<Task[]>;
}

const STARTS_WITH_REF = /^[A-Z][A-Z0-9]*-\d+\b/;
const ISSUE_REF = /\b[A-Z][A-Z0-9]*-\d+\b/;
const EDIT_KEYWORDS = /\b(change|set|update|make|rename|edit|move|due|priority|prio|description|desc|details|notes|context|deadline|title|clear|remove|delete|unset|today|tomorrow|p[0-4])\b/i;
const COMMAND_KEYWORD = /^(done|move|priority|prio|p0|p1|p2|p3|p4|blocked|drop|add|today|plan|list|inbox|yes|no|cancel|y|n|help|projects?|refresh|reload|sync)\b/i;
const PROJECT_NL = /^(?:create|make|add|new|start|set\s*up|setup)\s+(?:a\s+|an\s+)?(?:new\s+)?project\b/i;
const PROJECT_LIST_NL = /^(?:list|show|all|see)\s+(?:all\s+)?projects?\b/i;

export function createAIAdapter(opts: {
  apiKey: string;
  modelId: string;
  timezone: string;
  /** Snapshot accessor for live area/project names. Called per request; should be cheap (in-memory). */
  getAreas: () => string[];
}): AIAdapter {
  const client = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: opts.apiKey,
    headers: {
      'HTTP-Referer': 'https://github.com/ritavdas/whatnottodo',
        'X-Title': 'whatnottodo',
    },
  });
  const model = client(opts.modelId);

  return {
    async routeIntent(message) {
      const trimmed = message.trim();
      if (ISSUE_REF.test(trimmed) && (STARTS_WITH_REF.test(trimmed) || EDIT_KEYWORDS.test(trimmed))) {
        return 'command';
      }
      if (COMMAND_KEYWORD.test(trimmed)) return 'command';
      if (PROJECT_NL.test(trimmed) || PROJECT_LIST_NL.test(trimmed)) return 'command';
      if (trimmed.length < 250 && !trimmed.includes('\n')) return 'single_task';

      const { text } = await generateText({
        model,
        prompt: `${ROUTE_INTENT_PROMPT}\n\nMessage: """${trimmed}"""`,
        maxOutputTokens: 20,
      });
      const out = text.trim().toLowerCase();
      const result = IntentSchema.safeParse(out);
      return result.success ? result.data : 'chitchat';
    },

    async parseTasks(text) {
      const today = todayLocal(opts.timezone);
      const areas = opts.getAreas();
      const areaSet = new Set(areas.map(a => a.toLowerCase()));
      try {
        const { object } = await generateObject({
          model,
          schema: ParseTasksOutputSchema,
          system: `${buildParseTaskPrompt(areas)}\n\nToday's date: ${today}`,
          prompt: text,
          maxOutputTokens: 2000,
          experimental_repairText: repairJsonText,
        });
        // Drop any hallucinated area names not in the live project list.
        const tasks = object.tasks.map(t => ({
          ...t,
          area: t.area && areaSet.has(t.area.toLowerCase()) ? t.area : null,
        }));
        return { tasks, thoughts: object.thoughts };
      } catch (err) {
        console.error('parseTasks failed:', err);
        // Deterministic fallback: never lose a clear short action to a flaky LLM JSON failure.
        const trimmed = text.trim();
        if (trimmed && trimmed.length <= 120 && !trimmed.includes('\n')) {
          return {
            tasks: [{ title: trimmed, area: null, priority: null, dueDate: null, context: null }],
            thoughts: [],
          };
        }
        return { tasks: [], thoughts: [text] };
      }
    },

    async parseIssueEdit(text) {
      const today = todayLocal(opts.timezone);
      try {
        const { object } = await generateObject({
          model,
          schema: IssueEditOutputSchema,
          system: `${EDIT_ISSUE_PROMPT}\n\nToday's date: ${today}`,
          prompt: text,
          maxOutputTokens: 1000,
          experimental_repairText: repairJsonText,
        });
        if (object.fields.dueDate === null &&
            !/\b(clear|remove|delete|unset|no)\b.*\b(due|date|deadline)\b/i.test(text)) {
          const { dueDate: _drop, ...rest } = object.fields;
          return { issueRef: object.issueRef, fields: rest };
        }
        return object;
      } catch (err) {
        console.error('parseIssueEdit failed:', err);
        return { issueRef: null, fields: {} };
      }
    },

    async chat(message) {
      const { text } = await generateText({
        model,
        system: `You are Ritav's personal task bot. Keep replies under 3 sentences. Be direct and warm. If the user is venting or rambling, listen. If they want to add tasks, gently nudge them to use commands like "add X" or just dump a list.`,
        prompt: message,
        maxOutputTokens: 300,
      });
      return text.trim() || 'noted.';
    },

    async pickFocus(tasks) {
      if (tasks.length === 0) return [];
      if (tasks.length <= 3) return tasks;
      const sample = tasks.slice(0, 20);
      const summary = sample.map((t, idx) =>
        `${idx}. [${t.identifier}] ${t.title} (${t.areaName ?? 'no area'}, due ${t.dueDate ?? 'none'}, priority ${t.priorityLabel ?? 'none'})`
      ).join('\n');
      const { text } = await generateText({
        model,
        system: `You pick 1-3 focus tasks for today from the user's task list. Pick by impact and urgency. Prefer tasks that move important projects forward over admin chores. Reply with ONLY the indices comma-separated, e.g. "0,3,7".`,
        prompt: summary,
        maxOutputTokens: 100,
      });
      const indices = text.trim().split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isInteger(n) && n >= 0 && n < sample.length);
      const out: Task[] = [];
      for (const i of indices.slice(0, 3)) {
        const t = sample[i];
        if (t) out.push(t);
      }
      return out;
    },
  };
}
