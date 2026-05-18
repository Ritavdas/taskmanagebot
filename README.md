# whatnottodo

Personal task OS. Discord DM ↔ Linear ↔ AI triage.

```
Apple Notes (raw thoughts) → Discord DM → AI parser → Linear (source of truth)
                                            ↓
                            Morning digest 10:30 AM
                            Evening close-out 10:30 PM
```

## What it does

- **Capture**: DM the bot anything. AI parses messy text into proposed Linear tasks. You confirm.
- **Morning digest** (10:30 AM IST): bot DMs you due-today, overdue, and 1-3 proposed focus tasks.
- **Evening close-out** (10:30 PM IST): bot DMs you today's list. You respond conversationally.
- **Commands** (anytime, in DM):
  - `done PER-12` or `done linkedin` (substring match)
  - `move PER-12 to friday`
  - `priority PER-12 P0` or `p1 linkedin`
  - `RIT2-12 change description to waiting for reply from vendor`
  - `RIT2-12 set due date to tomorrow`
  - `RIT2-12 make priority P1`
  - `blocked PER-12 because waiting on Tushar`
  - `drop PER-12`
  - `add P0 fix the launchpad bug for the meetup`
  - `today PER-12` (mark as focus for today)
  - `plan PER-12` (move from inbox to planned)
  - `list` (show today's tasks)
  - `inbox` (show triage queue)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Run interactive setup

```bash
npm run setup
```

This walks you through 5 credentials. For each one it opens the right page in your browser, tells you exactly what to click, and saves the value to `.env`. Re-runnable — keeps existing values.

The 5 credentials:
1. **OpenRouter API key** — for the AI parsing layer
2. **Linear API key** — task source of truth
3. **Linear team key** — defaults to `PER`
4. **Discord bot token** — for the chat interface
5. **Your Discord user ID** — so the bot only talks to you

### 3. Bootstrap Linear

```bash
npm run bootstrap
```

Creates the 6 area projects in your Linear team.

### 4. Run

```bash
npm start
```

The bot stays running, listens for DMs, and fires the morning/evening cron jobs.

### Manual setup (alternative)

If you'd rather skip `npm run setup`:

```bash
cp .env.example .env
# fill in the values manually
```

Where to get each:

**Discord bot**:
1. Go to https://discord.com/developers/applications → New Application
2. Bot → Reset Token → copy `DISCORD_BOT_TOKEN`
3. Bot → enable `MESSAGE CONTENT INTENT`
4. OAuth2 → URL Generator → scopes: `bot`, permissions: `Send Messages`, `Read Message History`
5. Use the URL to add bot to a private server (or DM-only mode is fine; just need shared server first)
6. Find your own Discord user ID: enable Developer Mode in Discord settings → right-click yourself → Copy User ID → that's `DISCORD_OWNER_ID`

**Linear**:
1. https://linear.app/settings/api → Personal API key → copy `LINEAR_API_KEY`
2. Create a team called "Personal" (or whatever) → note the key (e.g., `PER`) → that's `LINEAR_TEAM_KEY`
3. Inside that team, create projects matching your areas. Defaults the bot uses:
   - Professional Work
   - Content Creation
   - Meetup/Community
   - Personal Admin
   - Relationship/Family
   - Health/Fitness

**OpenRouter**:
- https://openrouter.ai/keys → create key → `OPENROUTER_API_KEY`
- Default model is `anthropic/claude-sonnet-4.5`. Cheaper option: `anthropic/claude-haiku-4.5` or any free model from openrouter.ai/models

## Running in production

For a personal tool, run on:
- A cheap VPS (Hetzner $5/mo) with `pm2` or `systemd`
- Fly.io free tier
- A Raspberry Pi at home
- Just `npm start` in a tmux on your laptop (will miss cron when laptop is asleep)

```bash
# pm2 example
npm install -g pm2
pm2 start npm --name whatnottodo -- start
pm2 save
pm2 startup
```

## Architecture

- `src/index.js` — Discord client, cron scheduler, message router
- `src/linear.js` — Linear API wrapper (CRUD + state/project caching)
- `src/ai.js` — OpenRouter-powered intent parsing, priority parsing, and task extraction
- `src/commands.js` — Conversational command handlers
- `src/digest.js` — Morning digest builder
- `src/closeout.js` — Evening close-out builder
- `src/bootstrap.js` — One-time Linear setup
- `scripts/setup.js` — Interactive credential setup

## Status lifecycle

| Bot state | Linear representation |
|---|---|
| Inbox | Backlog (no due date) |
| Planned | Todo (no due date) |
| Today | Todo or In Progress (due date = today) |
| In Progress | In Progress |
| Done | Done |
| Dropped | Cancelled |
| Blocked | label `blocked` added (state preserved) |

## Priority mapping

| Bot shorthand | Linear priority |
|---|---|
| P0 | Urgent |
| P1 | High |
| P2 | Normal |
| P3 | Low |
| P4 | No priority |
