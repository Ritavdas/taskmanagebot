import { Client, GatewayIntentBits, Partials, Events, type Message } from 'discord.js';

export interface DiscordAdapter {
  start(): Promise<void>;
  onOwnerMessage(handler: (text: string, reply: (content: string) => Promise<void>) => Promise<void>): void;
  sendToOwner(content: string): Promise<void>;
}

export function createDiscordAdapter(opts: { token: string; ownerId: string }): DiscordAdapter {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  let ownerDM: Awaited<ReturnType<Awaited<ReturnType<typeof client.users.fetch>>['createDM']>> | null = null;
  const messageHandlers: Array<(text: string, reply: (content: string) => Promise<void>) => Promise<void>> = [];

  async function getOwnerDM() {
    if (ownerDM) return ownerDM;
    const user = await client.users.fetch(opts.ownerId);
    ownerDM = await user.createDM();
    return ownerDM;
  }

  async function handleMessage(msg: Message) {
    if (msg.author.bot) return;
    if (msg.author.id !== opts.ownerId) return;
    const isDM = !msg.guild;
    if (!isDM && client.user && !msg.mentions.has(client.user)) return;

    const text = isDM ? msg.content : msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!text) return;

    const reply = async (content: string) => {
      await msg.reply(content);
    };

    for (const handler of messageHandlers) {
      try {
        await handler(text, reply);
      } catch (err) {
        console.error('message handler error:', err);
        await reply(`⚠️ something broke: ${(err as Error).message}`).catch(() => {});
      }
    }
  }

  return {
    async start() {
      const ready = new Promise<void>((resolve) => {
        client.once(Events.ClientReady, async (c) => {
          console.log(`✓ logged in as ${c.user.tag}`);
          try {
            await getOwnerDM();
            console.log(`✓ owner DM channel ready (${opts.ownerId})`);
          } catch (err) {
            console.error('could NOT open DM with owner. Make sure you share a server with the bot.', (err as Error).message);
          }
          resolve();
        });
      });

      client.on(Events.MessageCreate, (msg) => { void handleMessage(msg); });

      await client.login(opts.token);
      await ready;
    },

    onOwnerMessage(handler) {
      messageHandlers.push(handler);
    },

    async sendToOwner(content) {
      const dm = await getOwnerDM();
      for (let i = 0; i < content.length; i += 1900) {
        await dm.send(content.slice(i, i + 1900));
      }
    },
  };
}
