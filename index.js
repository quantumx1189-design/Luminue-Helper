const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

const BAN_REASON = "Banned from the United Group Alliance - Banned from a partner server.";
const UNBAN_REASON = "Unbanned in all partner servers. United Group Alliance.";

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guilds = [...client.guilds.cache.values()];

  // Map: userId -> number of servers they are banned in
  const banCount = new Map();

  // Step 1: Count bans across all servers
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => {
        banCount.set(
          ban.user.id,
          (banCount.get(ban.user.id) || 0) + 1
        );
      });
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}`, err.message);
    }
  }

  // Step 2: Sync bans and unbans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();

      // Apply bans
      for (const [userId, count] of banCount) {
        if (count > 0 && !bans.has(userId)) {
          await guild.members.ban(userId, { reason: BAN_REASON });
          console.log(`Banned ${userId} in ${guild.name}`);
        }
      }

      // Apply unbans
      for (const ban of bans.values()) {
        if (!banCount.has(ban.user.id)) {
          await guild.members.unban(ban.user.id, { reason: UNBAN_REASON });
          console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
        }
      }

    } catch (err) {
      console.error(`Failed syncing bans/unbans for ${guild.name}`, err.message);
    }
  }

  console.log("Ban and unban sync complete. Shutting down.");
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
