import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  discord: {
    token: required('DISCORD_BOT_TOKEN'),
    ownerId: required('DISCORD_OWNER_ID'),
  },
  linear: {
    apiKey: required('LINEAR_API_KEY'),
    teamKey: process.env.LINEAR_TEAM_KEY || 'PER',
  },
  ai: {
    apiKey: required('OPENROUTER_API_KEY'),
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
  },
  schedule: {
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
    morningCron: process.env.MORNING_CRON || '30 10 * * *',
    eveningCron: process.env.EVENING_CRON || '30 22 * * *',
    disabled: process.env.DISABLE_CRON === 'true',
  },
  areas: [
    'Professional Work',
    'Content Creation',
    'Meetup/Community',
    'Personal Admin',
    'Relationship/Family',
    'Health/Fitness',
  ],
};
