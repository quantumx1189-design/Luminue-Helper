const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEM;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEM env var");
  process.exit(1);
}

async function run() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration
    ]
  });

  await client.login(TOKEN);
  console.log(`Logged in as ${client.user.tag}`);

  const guilds = [...client.guilds.cache.values()];

  for (const guild of guilds) {
    const bans = await guild.bans.fetch();
    console.log(`${guild.name}: ${bans.size} bans`);
  }

  await client.destroy();
  process.exit(0);
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});  // Step 2: Sync bans and unbans
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

client.login(process.env.DISCORD_TOKEN); the 
