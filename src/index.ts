import { config } from './infra/env.ts';
import { createLinearAdapter } from './infra/linear.ts';
import { createAIAdapter } from './infra/ai.ts';
import { createDiscordAdapter } from './infra/discord.ts';
import { createScheduler } from './infra/scheduler.ts';
import { createRouter } from './app/router.ts';
import { buildMorningDigest } from './app/digest.ts';
import { buildEveningCloseout } from './app/closeout.ts';

async function main(): Promise<void> {
  const oneShot = process.argv.includes('--run-digest') ? 'digest'
                : process.argv.includes('--run-closeout') ? 'closeout'
                : null;

  const linear = createLinearAdapter({
    apiKey: config.linear.apiKey,
    teamKey: config.linear.teamKey,
    timezone: config.schedule.timezone,
  });
  const ai = createAIAdapter({
    apiKey: config.ai.apiKey,
    modelId: config.ai.model,
    timezone: config.schedule.timezone,
  });
  const discord = createDiscordAdapter({
    token: config.discord.token,
    ownerId: config.discord.ownerId,
  });

  console.log('initializing Linear...');
  await linear.init();
  console.log(`✓ Linear team "${config.linear.teamKey}" ready, ${linear.listAreas().length} projects.`);

  const runDigest = async () => {
    try {
      const text = await buildMorningDigest(linear, ai, config.schedule.timezone);
      await discord.sendToOwner(text);
      console.log(`[${new Date().toISOString()}] morning digest sent`);
    } catch (err) {
      console.error('digest error:', err);
      await discord.sendToOwner(`⚠️ digest failed: ${(err as Error).message}`).catch(() => {});
    }
  };

  const runCloseout = async () => {
    try {
      const text = await buildEveningCloseout(linear);
      await discord.sendToOwner(text);
      console.log(`[${new Date().toISOString()}] evening close-out sent`);
    } catch (err) {
      console.error('closeout error:', err);
      await discord.sendToOwner(`⚠️ close-out failed: ${(err as Error).message}`).catch(() => {});
    }
  };

  console.log('connecting to Discord...');
  await discord.start();

  if (oneShot === 'digest') {
    await runDigest();
    process.exit(0);
  }
  if (oneShot === 'closeout') {
    await runCloseout();
    process.exit(0);
  }

  if (config.schedule.disabled) {
    console.log('cron disabled (DISABLE_CRON=true)');
  } else {
    const scheduler = createScheduler(config.schedule.timezone);
    scheduler.schedule(config.schedule.morningCron, runDigest);
    scheduler.schedule(config.schedule.eveningCron, runCloseout);
    console.log(`✓ cron scheduled: morning="${config.schedule.morningCron}", evening="${config.schedule.eveningCron}" (${config.schedule.timezone})`);
  }

  const route = createRouter({ linear, ai, timezone: config.schedule.timezone });
  discord.onOwnerMessage(route);

  await discord.sendToOwner(`🟢 bot online. type \`help\` to see commands.`).catch(() => {});
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(1);
});
