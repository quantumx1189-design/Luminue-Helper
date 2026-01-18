const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans
  ]
});

/*
  SERVERS INCLUDED IN THE GLOBAL BAN NETWORK
  To add another server later:
  1. Copy a line
  2. Paste it
  3. Change the name + ID
*/

const GUILDS = {
  YOSHI_TRANSIT: "1369785660512272444",
  LUMINUE: "1221977896135168080",
  THEHIDEOUT_BLOXBURG: "1440469850009899102",
  KAMARI_CONTAINMENT: "1461474214635769961"
};

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("guildBanAdd", async (ban) => {
  for (const guildId of Object.values(GUILDS)) {
    if (guildId === ban.guild.id) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    try {
      await guild.members.ban(ban.user.id, {
        reason: "Global ban sync"
      });
    } catch {
      // silently ignore failures (missing perms, already banned, etc.)
    }
  }
});

client.login(process.env.TOKEN);
