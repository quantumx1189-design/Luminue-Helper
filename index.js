const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

const BAN_REASON = "Banned in a partner server.";
const UNBAN_REASON = "Unbanned in all partner servers.";
const PORT = process.env.PORT || 3000;

const app = express();

// Tiny HTTP endpoint to let a ping service wake the bot
app.get("/", async (req, res) => {
  console.log("Ping received. Running ban/unban sync...");
  await syncBans();
  res.send("Ban/unban sync complete.");
});

async function syncBans() {
  const guilds = [...client.guilds.cache.values()];
  const banCount = new Map();

  // Step 1: Count bans across all servers
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => {
        banCount.set(ban.user.id, (banCount.get(ban.user.id) || 0) + 1);
      });
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}`, err.message);
    }
  }

  // Step 2: Apply bans and unbans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();

      // Bans
      for (const [userId, count] of banCount) {
        if (count > 0 && !bans.has(userId)) {
          await guild.members.ban(userId, { reason: BAN_REASON });
          console.log(`Banned ${userId} in ${guild.name}`);
        }
      }

      // Unbans
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

  console.log("Ban/unban sync complete.");
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
