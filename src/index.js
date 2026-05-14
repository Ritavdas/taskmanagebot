import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import cron from 'node-cron';
import { config } from './config.js';
import * as linear from './linear.js';
import * as ai from './ai.js';
import { handleCommand } from './commands.js';
import { buildMorningDigest } from './digest.js';
import { buildEveningCloseout } from './closeout.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

let ownerDM = null;

async function getOwnerDM() {
  if (ownerDM) return ownerDM;
  const user = await client.users.fetch(config.discord.ownerId);
  ownerDM = await user.createDM();
  return ownerDM;
}

async function sendToOwner(content) {
  const dm = await getOwnerDM();
  for (let i = 0; i < content.length; i += 1900) {
    await dm.send(content.slice(i, i + 1900));
  }
}

async function runDigest() {
  try {
    const text = await buildMorningDigest();
    await sendToOwner(text);
    console.log(`[${new Date().toISOString()}] morning digest sent`);
  } catch (err) {
    console.error('digest error:', err);
    await sendToOwner(`⚠️ digest failed: ${err.message}`).catch(() => {});
  }
}

async function runCloseout() {
  try {
    const text = await buildEveningCloseout();
    await sendToOwner(text);
    console.log(`[${new Date().toISOString()}] evening close-out sent`);
  } catch (err) {
    console.error('closeout error:', err);
    await sendToOwner(`⚠️ close-out failed: ${err.message}`).catch(() => {});
  }
}

async function handleMessage(msg) {
  if (msg.author.bot) return;
  if (msg.author.id !== config.discord.ownerId) return;
  const isDM = !msg.guild;
  if (!isDM && !msg.mentions.has(client.user)) return;

  const text = isDM ? msg.content : msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!text) return;

  const reply = (content) => msg.reply(content);

  try {
    const intent = await ai.routeIntent(text);
    console.log(`[msg] intent=${intent} text="${text.slice(0, 80)}"`);

    if (intent === 'command') {
      await handleCommand(text, reply);
      return;
    }

    if (intent === 'single_task') {
      await handleCommand(`add ${text}`, reply);
      return;
    }

    if (intent === 'dump') {
      const { tasks, thoughts } = await ai.parseTasks(text);
      if (tasks.length === 0) {
        await reply(`couldn't pull clear actions out of that. ${thoughts.length ? 'noted as thoughts.' : ''}`);
        return;
      }
      const lines = [`extracted ${tasks.length} task${tasks.length > 1 ? 's' : ''}:`];
      for (const t of tasks) {
        lines.push(`• **${t.title}** _(${t.area || 'no area'}${t.dueDate ? ' · due ' + t.dueDate : ''})_`);
      }
      if (thoughts.length > 0) {
        lines.push('');
        lines.push(`_kept as thoughts (not added):_`);
        for (const t of thoughts) lines.push(`💭 ${t}`);
      }
      lines.push('');
      lines.push('creating these now...');
      await reply(lines.join('\n'));

      const created = [];
      for (const t of tasks) {
        const issue = await linear.createIssue(t);
        created.push(await linear.formatIssue(issue));
      }
      await reply(`✅ added:\n${created.join('\n')}`);
      return;
    }

    const response = await ai.chat(text);
    await reply(response);
  } catch (err) {
    console.error('message handler error:', err);
    await reply(`⚠️ something broke: ${err.message}`);
  }
}

async function main() {
  const oneShot = process.argv.includes('--run-digest') ? 'digest'
                : process.argv.includes('--run-closeout') ? 'closeout'
                : null;

  console.log('initializing Linear...');
  await linear.init();
  console.log(`✓ Linear team "${config.linear.teamKey}" ready, ${linear.listAreas().length} projects.`);

  console.log('connecting to Discord...');
  client.once(Events.ClientReady, async (c) => {
    console.log(`✓ logged in as ${c.user.tag}`);
    try {
      await getOwnerDM();
      console.log(`✓ owner DM channel ready (${config.discord.ownerId})`);
    } catch (err) {
      console.error('could NOT open DM with owner. Make sure you share a server with the bot.', err.message);
    }

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
      cron.schedule(config.schedule.morningCron, runDigest, { timezone: config.schedule.timezone });
      cron.schedule(config.schedule.eveningCron, runCloseout, { timezone: config.schedule.timezone });
      console.log(`✓ cron scheduled: morning="${config.schedule.morningCron}", evening="${config.schedule.eveningCron}" (${config.schedule.timezone})`);
    }

    await sendToOwner(`🟢 bot online. type \`help\` to see commands.`).catch(() => {});
  });

  client.on(Events.MessageCreate, handleMessage);

  await client.login(config.discord.token);
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(1);
});
