import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { config } from './config.js';

let _client = null;
function client() {
  if (_client) return _client;
  _client = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.ai.apiKey,
    headers: {
      'HTTP-Referer': 'https://github.com/ritavdas/whatnottodo',
      'X-Title': 'whatnottodo',
    },
  });
  return _client;
}

function model() {
  return client()(config.ai.model);
}

const AREAS = config.areas;

const PARSE_TASK_PROMPT = `You are the parser layer of a personal task OS for Ritav Das, a software engineer at Microsoft Hyderabad.

Your job: take a freeform brain dump and extract concrete next actions.

Areas (pick exactly one per task):
${AREAS.map(a => `- ${a}`).join('\n')}

Rules:
1. Only extract things that are clear next actions. Vague thoughts/feelings → skip them.
2. Each task needs a short imperative title (max 10 words), a single area, and optional dueDate (YYYY-MM-DD) if stated.
3. If user mentions "today" → dueDate is today. "tomorrow" → tomorrow. "friday" → next friday. "next week" → leave dueDate null.
4. If something is just a thought, idea, or feeling without an action → put it in "thoughts" array, not "tasks".
5. Professional work tasks must be sanitized — no internal Microsoft/Azure project names, no customer details, no confidential info. Generalize them.

Return ONLY valid JSON in this shape:
{
  "tasks": [
    { "title": "...", "area": "...", "dueDate": "YYYY-MM-DD" | null, "context": "..." | null }
  ],
  "thoughts": ["..."]
}`;

const ROUTE_INTENT_PROMPT = `You are the intent router for a personal task bot. Classify the user's message into ONE intent.

Intents:
- "command": user is issuing a structured command like done/move/blocked/drop/add/today/plan/list/inbox/yes/no/cancel
- "dump": user is brain-dumping multiple thoughts/tasks to triage
- "single_task": user is describing one task to add
- "chitchat": user is just chatting, asking a question, saying hi, etc.

Respond with ONLY the intent word.

Message: """{{MSG}}"""`;

export async function routeIntent(message) {
  const trimmed = message.trim();
  if (/^(done|move|blocked|drop|add|today|plan|list|inbox|yes|no|cancel|y|n|help)\b/i.test(trimmed)) {
    return 'command';
  }
  if (trimmed.length < 250 && !trimmed.includes('\n')) {
    return 'single_task';
  }
  const { text } = await generateText({
    model: model(),
    prompt: ROUTE_INTENT_PROMPT.replace('{{MSG}}', trimmed),
    maxTokens: 20,
  });
  const out = text.trim().toLowerCase();
  if (['command', 'dump', 'single_task', 'chitchat'].includes(out)) return out;
  return 'chitchat';
}

export async function parseTasks(text) {
  const today = new Date().toISOString().slice(0, 10);
  const { text: raw } = await generateText({
    model: model(),
    system: PARSE_TASK_PROMPT + `\n\nToday's date: ${today}`,
    prompt: text,
    maxTokens: 2000,
  });
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : [],
    };
  } catch {
    return { tasks: [], thoughts: [text] };
  }
}

export async function chat(message) {
  const { text } = await generateText({
    model: model(),
    system: `You are Ritav's personal task bot. Keep replies under 3 sentences. Be direct and warm. If the user is venting or rambling, listen. If they want to add tasks, gently nudge them to use commands like "add X" or just dump a list.`,
    prompt: message,
    maxTokens: 300,
  });
  return text.trim() || 'noted.';
}

export async function pickFocus(issues) {
  if (issues.length === 0) return [];
  if (issues.length <= 3) return issues;
  const summary = await Promise.all(issues.slice(0, 20).map(async (i, idx) => {
    const project = await i.project;
    return `${idx}. [${i.identifier}] ${i.title} (${project?.name || 'no area'}, due ${i.dueDate || 'none'})`;
  }));
  const { text } = await generateText({
    model: model(),
    system: `You pick 1-3 focus tasks for today from the user's task list. Pick by impact and urgency. Prefer tasks that move important projects forward over admin chores. Reply with ONLY the indices comma-separated, e.g. "0,3,7".`,
    prompt: summary.join('\n'),
    maxTokens: 100,
  });
  const indices = text.trim().split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n < issues.length);
  return indices.slice(0, 3).map(i => issues[i]);
}
