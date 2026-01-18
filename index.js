// index.js
const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN env var. Set it in Fly secrets.");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const BAN_REASON = "Banned in a partner server. Blacklisted from unitd group alliance.";
const UNBAN_REASON = "Unbanned in all partner servers.";

// Simple single-run lock so we don't run overlapping syncs
let syncRunning = false;

const app = express();

// Health check / wake endpoint
app.get("/", async (req, res) => {
  if (syncRunning) {
    console.log("Received ping but a sync is already running. Returning 202.");
    return res.status(202).send("Sync already running");
  }

  syncRunning = true;
  // Safety timeout: don't let a sync run forever
  const SAFETY_TIMEOUT = 2 * 60 * 1000; // 2 minutes
  const safetyTimer = setTimeout(() => {
    console.error("Sync exceeded safety timeout — marking as finished.");
    syncRunning = false;
  }, SAFETY_TIMEOUT);

  try {
    console.log("Ping received. Starting sync run.");
    await runSyncOnce();
    clearTimeout(safetyTimer);
    syncRunning = false;
    console.log("Sync run finished OK.");
    return res.send("Ban/unban sync complete.");
  } catch (err) {
    clearTimeout(safetyTimer);
    syncRunning = false;
    console.error("Sync run failed:", err);
    return res.status(500).send("Sync failed: " + (err && err.message ? err.message : String(err)));
  }
});

// Start server immediately so the ping can reach us
app.listen(PORT, () => {
  console.log(`HTTP wake endpoint listening on port ${PORT}`);
});

// Main sync routine: creates a fresh ephemeral Discord client, logs in, does one sync, then destroys client.
async function runSyncOnce() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration],
    makeCache: () => new Map(), // keep minimal cache behavior
  });

  // Ensure we log any unhandled client errors so Fly logs them
  client.on("error", (err) => console.error("Discord client error:", err));
  client.on("shardError", (err) => console.error("Discord shard error:", err));

  try {
    await client.login(TOKEN);
    // Wait for ready
    await onceReady(client);

    console.log(`Logged in as ${client.user.tag}. Discovering guilds...`);

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
