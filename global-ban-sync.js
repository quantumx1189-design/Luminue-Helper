// global-ban-sync.js
// Node 18+ recommended
// Ensure DISCORD_TOKEN is set in the environment before starting

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField
} = require("discord.js");

/* ---- CONFIG ---- */
const DATA_FILE = process.env.BANS_JSON_PATH || path.join(__dirname, "data", "bans.json");
// If running on Fly with a persistent volume, set BANS_JSON_PATH to the mounted path.
const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID || "1462251909879435454";
const MOD_ROLE_NAME = process.env.MOD_ROLE_NAME || "Manager";
const TOKEN = process.env.DISCORD_TOKEN;
const ALLIANCE_NAME = process.env.ALLIANCE_NAME || "United Group Alliance";
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || ":UGAGlobalUnban";
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/* ---- safety guard: prevent double-start in weird module reloads ---- */
if (global.__UGA_BOT_STARTED) {
  console.log("Bot already started in this process. Exiting duplicate start.");
  process.exit(0);
}
global.__UGA_BOT_STARTED = true;

/* ---- helpers ---- */
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { users: {}, blockedGuilds: [] };
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("Failed to load data file, starting fresh:", e && e.message);
    return { users: {}, blockedGuilds: [] };
  }
}

function saveData(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Save failed:", e && e.message);
  }
}

/* ---- core sync logic ---- */
async function runFullSync(client) {
  try {
    console.log("[SYNC] Starting full sync...");
    const data = loadData();
    const guilds = Array.from(client.guilds.cache.values());
    const unbanQueue = [];

    // Scan each guild and update our record
    for (let i = 0; i < guilds.length; i++) {
      const guild = guilds[i];
      let bansMap;
      try {
        bansMap = await guild.bans.fetch();
      } catch (err) {
        // Unable to fetch a guild's bans (permissions, etc.) — skip it.
        console.warn("[SYNC] Could not fetch bans for guild:", guild.id, guild.name);
        continue;
      }

      const currentBanIds = Array.from(bansMap.keys());

      // Add newly seen bans to our data file
      for (const [userId, ban] of bansMap) {
        if (!data.users[userId]) {
          data.users[userId] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            reason: ban.reason || "No reason provided",
            timestamp: Date.now()
          };
          console.log("[SYNC] New source ban recorded:", userId, "from", guild.name);
        }
      }

      // If a saved user was sourced from this guild but is no longer banned here -> unban everywhere
      for (const userId in data.users) {
        if (!Object.prototype.hasOwnProperty.call(data.users, userId)) continue;
        const info = data.users[userId];
        if (info.sourceGuildId === guild.id && currentBanIds.indexOf(userId) === -1) {
          console.log("[SYNC] Source cleared ban for", userId, "in", guild.name);
          unbanQueue.push(userId);
          delete data.users[userId];
        }
      }
    }

    // Apply unbans and propagate bans
    for (let i = 0; i < guilds.length; i++) {
      const guild = guilds[i];

      // Unban queued users in every guild
      for (let j = 0; j < unbanQueue.length; j++) {
        const userId = unbanQueue[j];
        try {
          await guild.bans.remove(userId, "Source unban synchronization");
        } catch (e) {
          // ignore per-guild unban failures
        }
        await sleep(200);
      }

      // Fetch existing bans in this guild once
      let existing;
      try {
        existing = await guild.bans.fetch();
      } catch {
        existing = new Map();
      }

      // For every recorded banned user, ensure this guild has them banned (unless it's the source)
      for (const userId in data.users) {
        if (!Object.prototype.hasOwnProperty.call(data.users, userId)) continue;
        const info = data.users[userId];
        if (info.sourceGuildId === guild.id) continue; // skip source guild
        if (existing.has(userId)) continue; // already banned here

        try {
          const reason =
            "Source: " +
            info.sourceGuildName +
            " | Reason: " +
            info.reason +
            " | " +
            ALLIANCE_NAME;
          await guild.bans.create(userId, { reason: reason });
        } catch (err) {
          // ignore per-guild failures, handle rate limit gently
          if (err && err.status === 429) {
            const wait = (err.rawError && err.rawError.retry_after ? err.rawError.retry_after : 5) * 1000;
            console.warn("[SYNC] Rate limited. Sleeping for", wait, "ms");
            await sleep(wait);
          }
        }
        await sleep(200);
      }
    }

    saveData(loadData() /* ensure we saved the current data */);
    console.log("[SYNC] Full sync finished.");
  } catch (ex) {
    console.error("[SYNC] Unexpected error:", ex && ex.stack ? ex.stack : ex);
  }
}

/* ---- Discord client (single declaration) ---- */
if (!TOKEN) {
  console.error("DISCORD_TOKEN environment variable is required. Exiting.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ---- Events ---- */
client.once("ready", function () {
  try {
    console.log("Bot ready:", client.user && client.user.tag ? client.user.tag : "unknown");
    // initial sync (do not await to avoid blocking)
    runFullSync(client).catch(function (e) {
      console.error("Initial sync failed:", e && e.message);
    });
    // schedule periodic syncs
    setInterval(function () {
      runFullSync(client).catch(function (e) {
        console.error("Scheduled sync failed:", e && e.message);
      });
    }, SYNC_INTERVAL_MS);
  } catch (e) {
    console.error("Ready handler error:", e && e.message);
  }
});

client.on("messageCreate", async function (message) {
  try {
    if (!message.guild) return;
    if (message.author && message.author.bot) return;
    if (message.guild.id !== MAIN_GUILD_ID) return;
    if (!message.content || message.content.indexOf(COMMAND_PREFIX) !== 0) return;

    const member = message.member;
    if (!member) return;

    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasManagerRole = member.roles.cache.some(function (r) {
      return r.name === MOD_ROLE_NAME;
    });

    if (!isAdmin && !hasManagerRole) {
      return message.reply("Access denied. Requires role or admin.");
    }

    const parts = message.content.trim().split(/\s+/);
    const targetId = parts[1];
    if (!targetId) return message.reply("Usage: " + COMMAND_PREFIX + " <UserID>");

    const status = await message.reply("Processing global unban for " + targetId);
    const data = loadData();

    if (data.users && data.users[targetId]) {
      delete data.users[targetId];
      saveData(data);
    }

    let successCount = 0;
    for (const g of client.guilds.cache.values()) {
      try {
        await g.bans.remove(targetId, "Global Appeal: " + (message.author ? message.author.tag : "moderator"));
        successCount++;
      } catch (e) {
        // ignore failures
      }
      await sleep(200);
    }

    await status.edit("Global unban complete. Unbanned from " + successCount + " servers.");
  } catch (e) {
    console.error("Command handler error:", e && e.stack ? e.stack : e);
  }
});

client.on("guildBanAdd", async function (ban) {
  try {
    const data = loadData();
    if (data.users && data.users[ban.user.id]) return;

    if (!data.users) data.users = {};
    data.users[ban.user.id] = {
      sourceGuildId: ban.guild.id,
      sourceGuildName: ban.guild.name,
      reason: ban.reason || "No reason provided",
      timestamp: Date.now()
    };
    saveData(data);

    for (const otherGuild of client.guilds.cache.values()) {
      if (otherGuild.id === ban.guild.id) continue;
      try {
        await sleep(200);
        await otherGuild.bans.create(ban.user.id, {
          reason:
            "Source: " +
            ban.guild.name +
            " | Reason: " +
            (ban.reason || "None") +
            " | " +
            ALLIANCE_NAME
        });
      } catch (e) {
        // ignore per-guild failures
      }
    }
  } catch (e) {
    console.error("guildBanAdd handler error:", e && e.stack ? e.stack : e);
  }
});

client.on("guildBanRemove", async function (ban) {
  try {
    const data = loadData();
    if (!data.users) return;
    const info = data.users[ban.user.id];
    if (!info) return;

    if (info.sourceGuildId === ban.guild.id) {
      // source cleared ban -> remove record and unban everywhere else
      delete data.users[ban.user.id];
      saveData(data);
      for (const otherGuild of client.guilds.cache.values()) {
        if (otherGuild.id === ban.guild.id) continue;
        try {
          await sleep(200);
          await otherGuild.bans.remove(ban.user.id, "Source unban synchronization");
        } catch (e) {
          // ignore per-guild failures
        }
      }
    }
  } catch (e) {
    console.error("guildBanRemove handler error:", e && e.stack ? e.stack : e);
  }
});

/* ---- error handling ---- */
process.on("unhandledRejection", function (reason) {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", function (err) {
  console.error("Uncaught Exception:", err && err.stack ? err.stack : err);
  // do not exit automatically on Fly; let platform restart if it wants
});

/* ---- start bot ---- */
client.login(TOKEN).catch(function (err) {
  console.error("Login failed:", err && err.message ? err.message : err);
  process.exit(1);
});
