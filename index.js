// index.js
const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN env var");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const BAN_REASON = "Banned in a partner server. Blacklisted from united group alliance.";
const UNBAN_REASON = "Unbanned in all partner servers.";

let syncRunning = false;

const app = express();

/**
 * Wake endpoint
 * Hitting this URL triggers a single sync run.
 */
app.get("/", async (req, res) => {
  if (syncRunning) {
    console.log("Sync already running");
    return res.status(202).send("Sync already running");
  }

  syncRunning = true;
  console.log("Ping received. Starting sync.");

  try {
    await runSyncOnce();
    console.log("Sync finished successfully.");
    res.send("Ban / unban sync complete.");
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

/**
 * One-shot Discord sync
 */
async function runSyncOnce() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration
    ]
  });

  await client.login(TOKEN);
  await waitForReady(client);

  console.log(`Logged in as ${client.user.tag}`);

  // Force-fetch all guilds the bot is in
  const guildCollection = await client.guilds.fetch();
  const guilds = [...guildCollection.values()];

  console.log(`Found ${guilds.length} guild(s)`);

  // Map of userId -> count of guilds banning them
  const banCount = new Map();

  // Fetch bans from every guild
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      console.log(`Fetched ${bans.size} bans from ${guild.name}`);

      bans.forEach(ban => {
        banCount.set(ban.user.id, (banCount.get(ban.user.id) || 0) + 1);
      });
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}:`, err.message);
    }
  }

  // Apply bans and unbans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();

      // Ban users banned elsewhere
      for (const [userId] of banCount) {
        if (!bans.has(userId)) {
          try {
            await guild.members.ban(userId, { reason: BAN_REASON });
            console.log(`Banned ${userId} in ${guild.name}`);
          } catch (err) {
            console.error(`Failed banning ${userId} in ${guild.name}:`, err.message);
          }
        }
      }

      // Unban users banned nowhere
      for (const ban of bans.values()) {
        if (!banCount.has(ban.user.id)) {
          try {
            await guild.members.unban(ban.user.id, { reason: UNBAN_REASON });
            console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
          } catch (err) {
            console.error(`Failed unbanning ${ban.user.id} in ${guild.name}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error(`Failed syncing ${guild.name}:`, err.message);
    }
  }

  await client.destroy();
}

/**
 * Wait for Discord ready event
 */
function waitForReady(client) {
  if (client.readyAt) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Discord ready timeout"));
    }, 30000);

    client.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });

    client.once("error", err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));    console.log(`Logged in as ${client.user.tag}. Discovering guilds...`);

    const guilds = [...client.guilds.cache.values()];

    // Build ban counts: userId -> number of servers that ban them
    const banCount = new Map();

    // Fetch bans from each guild (serial to keep rate limits sane)
    for (const guild of guilds) {
      try {
        const bans = await guild.bans.fetch();
        bans.forEach((ban) => {
          banCount.set(ban.user.id, (banCount.get(ban.user.id) || 0) + 1);
        });
        console.log(`Fetched ${bans.size} bans from ${guild.name}`);
      } catch (err) {
        console.error(`Failed fetching bans from ${guild.name} (${guild.id}):`, extractErrMsg(err));
      }
    }

    // Now apply bans/unbans in each guild
    for (const guild of guilds) {
      try {
        const bans = await guild.bans.fetch();
        // Apply bans (if someone is banned somewhere, ensure they are banned here)
        for (const [userId, count] of banCount.entries()) {
          if (count > 0 && !bans.has(userId)) {
            try {
              await guild.members.ban(userId, { reason: BAN_REASON });
              console.log(`Banned ${userId} in ${guild.name}`);
            } catch (err) {
              console.error(`Failed to ban ${userId} in ${guild.name}:`, extractErrMsg(err));
            }
          }
        }

        // Apply unbans (if someone is banned nowhere, unban here)
        for (const ban of bans.values()) {
          if (!banCount.has(ban.user.id)) {
            try {
              await guild.members.unban(ban.user.id, { reason: UNBAN_REASON });
              console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
            } catch (err) {
              console.error(`Failed to unban ${ban.user.id} in ${guild.name}:`, extractErrMsg(err));
            }
          }
        }
      } catch (err) {
        console.error(`Failed syncing bans/unbans for ${guild.name} (${guild.id}):`, extractErrMsg(err));
      }
    }

  } finally {
    // Always attempt to destroy client quietly
    try {
      await client.destroy();
    } catch (e) {
      // nothing
    }
  }
}

// Helper: wait for client ready with promise
function onceReady(client) {
  if (client.readyAt) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("error", onError);
    }
    client.once("ready", onReady);
    client.once("error", onError);
    // safety timer in case ready never fires
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Discord client did not become ready in time"));
    }, 30_000);
  });
}

function extractErrMsg(err) {
  try {
    if (!err) return String(err);
    if (err.message) return err.message;
    return String(err);
  } catch {
    return "Unknown error";
  }
}

// Graceful shutdown handlers (in case Fly sends SIGTERM)
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
