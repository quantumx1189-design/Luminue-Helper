const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

const BAN_REASON = "Banned in a partner server. Blacklisted from United Group Alliance.";

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration
    ]
  });

  await client.login(TOKEN);

  await new Promise(resolve => {
    client.once("ready", resolve);
  });

  console.log(`Logged in as ${client.user.tag}`);

  const guilds = Array.from(client.guilds.cache.values());
  const bannedUsers = new Set();

  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      for (const ban of bans.values()) {
        bannedUsers.add(ban.user.id);
      }
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}: ${err.message}`);
    }
  }

  for (const guild of guilds) {
    let existingBans;
    try {
      existingBans = await guild.bans.fetch();
    } catch {
      continue;
    }

    for (const userId of bannedUsers) {
      if (!existingBans.has(userId)) {
        try {
          await guild.members.ban(userId, { reason: BAN_REASON });
          console.log(`Banned ${userId} in ${guild.name}`);
        } catch (err) {
          console.error(`Failed banning ${userId} in ${guild.name}: ${err.message}`);
        }
      }
    }
  }

  console.log("Ban sync complete. Exiting.");
  await client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
