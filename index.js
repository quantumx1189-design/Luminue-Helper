const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

const BAN_REASON = "Banned in a partner server.";

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const allBans = new Set();

  const guilds = client.guilds.cache;

  // Step 1: Collect all banned users from all joined servers
  for (const guild of guilds.values()) {
    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => allBans.add(ban.user.id));
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}`, err.message);
    }
  }

  // Step 2: Apply bans everywhere
  for (const guild of guilds.values()) {
    try {
      const bans = await guild.bans.fetch();

      for (const userId of allBans) {
        if (!bans.has(userId)) {
          await guild.members.ban(userId, { reason: BAN_REASON });
          console.log(`Banned ${userId} in ${guild.name}`);
        }
      }
    } catch (err) {
      console.error(`Failed syncing bans to ${guild.name}`, err.message);
    }
  }

  console.log("Ban sync complete. Shutting down.");
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);

