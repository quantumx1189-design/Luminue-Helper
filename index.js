const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

const GUILD_IDS = [
  "1369785660512272444",
  "1221977896135168080",
  "1440469850009899102",
  "1461474214635769961"
];

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const allBans = new Map();

  // Step 1: Collect all bans
  for (const guildId of GUILD_IDS) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const bans = await guild.bans.fetch();

      bans.forEach(ban => {
        allBans.set(ban.user.id, ban.reason || "Synced ban");
      });

      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guildId}`, err.message);
    }
  }

  // Step 2: Apply bans everywhere
  for (const guildId of GUILD_IDS) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const bans = await guild.bans.fetch();

      for (const [userId, reason] of allBans) {
        if (!bans.has(userId)) {
          await guild.members.ban(userId, { reason });
          console.log(`Banned ${userId} in ${guild.name}`);
        }
      }
    } catch (err) {
      console.error(`Failed syncing bans to ${guildId}`, err.message);
    }
  }

  console.log("Ban sync complete. Shutting down.");
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
