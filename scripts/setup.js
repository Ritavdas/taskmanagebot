#!/usr/bin/env node
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';

const ENV_PATH = new URL('../.env', import.meta.url).pathname;

const STEPS = [
  {
    key: 'OPENROUTER_API_KEY',
    title: 'OpenRouter API key',
    url: 'https://openrouter.ai/keys',
    instructions: [
      '1. Sign in (Google/GitHub OK)',
      '2. Click "Create Key" → name it "whatnottodo"',
      '3. Copy the key (starts with sk-or-v1-...)',
    ],
  },
  {
    key: 'LINEAR_API_KEY',
    title: 'Linear personal API key',
    url: 'https://linear.app/settings/account/security',
    instructions: [
      '1. Sign in to Linear',
      '2. Scroll to "Personal API keys"',
      '3. Click "New API key" → label "whatnottodo bot" → Create',
      '4. Copy the key (starts with lin_api_...)',
    ],
  },
  {
    key: 'LINEAR_TEAM_KEY',
    title: 'Linear team key (e.g., PER for "Personal")',
    instructions: [
      'In Linear, this is the prefix on every issue (PER-1, PER-2, ...).',
      'Find it under Settings → Workspace → Teams. Default: PER',
      'If you don\'t have a personal team yet, create one called "Personal" with key "PER" first.',
    ],
    default: 'PER',
  },
  {
    key: 'DISCORD_BOT_TOKEN',
    title: 'Discord bot token',
    url: 'https://discord.com/developers/applications',
    instructions: [
      '1. Click "New Application" → name "whatnottodo" → Create',
      '2. Left sidebar → "Bot"',
      '3. Under "Privileged Gateway Intents" — toggle ON "MESSAGE CONTENT INTENT"',
      '4. Click "Reset Token" → copy the token',
      '5. THEN: left sidebar → "OAuth2" → "URL Generator"',
      '   - Scopes: check "bot"',
      '   - Bot permissions: check "Send Messages", "Read Message History"',
      '   - Copy the generated URL at the bottom, open it in a new tab,',
      '     and add the bot to ANY private server you own (the bot only needs',
      '     to share a server with you so it can DM you)',
    ],
  },
  {
    key: 'DISCORD_OWNER_ID',
    title: 'Your Discord user ID',
    url: 'https://discord.com/channels/@me',
    instructions: [
      '1. In Discord: Settings → Advanced → toggle ON "Developer Mode"',
      '2. Click your avatar / profile in any chat → "Copy User ID"',
      '   (Or: right-click your name in member list → "Copy User ID")',
      '3. Paste here (a long number like 123456789012345678)',
    ],
  },
];

function openInBrowser(url) {
  if (!url) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

function loadExisting() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnv(vars) {
  const lines = [
    '# Discord',
    `DISCORD_BOT_TOKEN=${vars.DISCORD_BOT_TOKEN || ''}`,
    `DISCORD_OWNER_ID=${vars.DISCORD_OWNER_ID || ''}`,
    '',
    '# Linear',
    `LINEAR_API_KEY=${vars.LINEAR_API_KEY || ''}`,
    `LINEAR_TEAM_KEY=${vars.LINEAR_TEAM_KEY || 'PER'}`,
    '',
    '# AI (OpenRouter)',
    `OPENROUTER_API_KEY=${vars.OPENROUTER_API_KEY || ''}`,
    `OPENROUTER_MODEL=${vars.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5'}`,
    '',
    '# Schedule',
    `TIMEZONE=${vars.TIMEZONE || 'Asia/Kolkata'}`,
    `MORNING_CRON=${vars.MORNING_CRON || '30 10 * * *'}`,
    `EVENING_CRON=${vars.EVENING_CRON || '30 22 * * *'}`,
    '',
    '# Set to true to skip cron (useful for dev)',
    `DISABLE_CRON=${vars.DISABLE_CRON || 'false'}`,
    '',
  ];
  writeFileSync(ENV_PATH, lines.join('\n'));
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const existing = loadExisting();

  console.log('\n🛠  whatnottodo setup\n');
  console.log('Walking you through 5 credentials. Each opens the right page in your browser.\n');

  for (const step of STEPS) {
    const cur = existing[step.key];
    console.log(`\n━━━ ${step.title} ━━━`);
    if (cur && cur.trim()) {
      const keep = await rl.question(`Already set (${cur.slice(0, 12)}...). Keep? [Y/n] `);
      if (!/^n/i.test(keep.trim())) continue;
    }
    if (step.url) {
      console.log(`→ Opening ${step.url}`);
      openInBrowser(step.url);
    }
    for (const line of step.instructions) console.log('  ' + line);
    const def = step.default ? ` [${step.default}]` : '';
    let val = '';
    while (!val) {
      val = (await rl.question(`\n${step.key}${def}: `)).trim();
      if (!val && step.default) val = step.default;
      if (!val) console.log('(required — paste the value)');
    }
    existing[step.key] = val;
    writeEnv(existing);
  }

  rl.close();
  console.log('\n✅ .env saved.\n');
  console.log('Next:');
  console.log('  npm run bootstrap   # creates the 6 area projects in Linear');
  console.log('  npm start           # runs the bot\n');
}

main().catch(err => {
  console.error('setup failed:', err);
  process.exit(1);
});
