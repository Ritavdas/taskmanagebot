import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_OWNER_ID: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_TEAM_KEY: z.string().min(1).default('PER'),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.5'),
  TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
  MORNING_CRON: z.string().min(1).default('30 10 * * *'),
  EVENING_CRON: z.string().min(1).default('30 22 * * *'),
  DISABLE_CRON: z.union([z.literal('true'), z.literal('false')]).default('false'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

export const config = {
  discord: {
    token: env.DISCORD_BOT_TOKEN,
    ownerId: env.DISCORD_OWNER_ID,
  },
  linear: {
    apiKey: env.LINEAR_API_KEY,
    teamKey: env.LINEAR_TEAM_KEY,
  },
  ai: {
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
  },
  schedule: {
    timezone: env.TIMEZONE,
    morningCron: env.MORNING_CRON,
    eveningCron: env.EVENING_CRON,
    disabled: env.DISABLE_CRON === 'true',
  },
} as const;

export type Config = typeof config;
