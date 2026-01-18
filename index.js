const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

const BAN_REASON = "Banned in a partner server.";

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration
    ]
  });

  await client.login(TOKEN);
  await new Promise(resolve => client.once("ready", resolve));

  console.log(`Logged in as ${client.user.tag}`);

  const guilds = [...client.guilds.cache.values()];
  const bannedUsers = new Set();

  // Collect bans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => bannedUsers.add(ban.user.id));
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}:`, err.message);
    }
  }

  // Apply bans everywhere
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
          console.error(`Failed banning ${userId} in ${guild.name}:`, err.message);
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
});    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration
    ]
  });

  await client.login(TOKEN);

  await new Promise(resolve => client.once("ready", resolve));
  console.log(`Logged in as ${client.user.tag}`);

  const guilds = [...client.guilds.cache.values()];
  const banCount = new Map();

  // Collect bans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      for (const ban of bans.values()) {
        banCount.set(
          ban.user.id,
          (banCount.get(ban.user.id) || 0) + 1
        );
      }
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed to fetch bans from ${guild.name}`, err.message);
    }
  }

  // Apply bans/unbans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();

      // Ensure bans
      for (const [userId] of banCount.entries()) {
        if (!bans.has(userId)) {
          try {
            await guild.members.ban(userId, { reason: BAN_REASON });
            console.log(`Banned ${userId} in ${guild.name}`);
          } catch (err) {
            console.error(`Failed to ban ${userId} in ${guild.name}`, err.message);
          }
        }
      }

      // Remove bans
      for (const ban of bans.values()) {
        if (!banCount.has(ban.user.id)) {
          try {
            await guild.members.unban(ban.user.id, UNBAN_REASON);
            console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
          } catch (err) {
            console.error(`Failed to unban ${ban.user.id} in ${guild.name}`, err.message);
          }
        }
      }
    } catc
