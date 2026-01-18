import { Client, GatewayIntentBits } from "discord.js";
import express from "express";

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("DISCORD_TOKEN env var is missing");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

const BAN_REASON = "Banned in a partner server. Blacklisted from alliance.";
const UNBAN_REASON = "Unbanned in all partner servers.";

let syncRunning = false;

// HTTP health / trigger endpoint
app.get("/", async (req, res) => {
  if (syncRunning) {
    return res.status(202).send("Sync already running");
  }

  syncRunning = true;

  try {
    await runSyncOnce();
    res.send("Ban sync complete");
  } catch (err) {
    console.error("Sync failed:", err);
    res.status(500).send("Sync failed");
  } finally {
    syncRunning = false;
  }
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

async function runSyncOnce() {
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
    } catch (err) {
      console.error(`Failed syncing ${guild.name}`, err.message);
    }
  }

  await client.destroy();
}
