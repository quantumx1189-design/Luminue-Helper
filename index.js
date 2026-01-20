const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN (set as Fly secret).");
  process.exit(1);
}

// File used to persist ban provenance and blocked guilds
const DATA_FILE = path.resolve(__dirname, "bans.json");

// Config — via environment variables
const EMERGENCY_REVERT_GUILD = process.env.EMERGENCY_REVERT_GUILD || null;
const GLOBAL_UNBAN_USER_ID = process.env.GLOBAL_UNBAN_USER_ID || null;
const UNBAN_LIMIT = parseInt(process.env.UNBAN_LIMIT || "100", 10);
const REVERT_LIMIT = parseInt(process.env.REVERT_LIMIT || "1000", 10);
const ALLIANCE_NAME = "United Group Alliance";

// --- Helper Functions ---

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { users: {}, blockedGuilds: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

function loadData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read or parse bans.json:", err);
    return { users: {}, blockedGuilds: [] };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to write bans.json:", err);
  }
}

// --- Main Execution Logic ---

async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
  });

  client.on("error", (e) => console.error("Discord client error:", e));

  // Initialize Connection
  await client.login(TOKEN);
  await new Promise(resolve => client.once("ready", resolve));

  console.log(`Logged in as ${client.user.tag}`);

  // Load state and cached guilds
  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());

  // ---------- MODE 1: EMERGENCY REVERT ----------
  if (EMERGENCY_REVERT_GUILD) {
    console.log(`EMERGENCY REVERT: undoing bans from guild ${EMERGENCY_REVERT_GUILD}`);
    let revertedCount = 0;

    for (const guild of guilds) {
      const userIds = Object.keys(data.users);
      for (const userId of userIds) {
        if (revertedCount >= REVERT_LIMIT) break;
        
        const info = data.users[userId];
        if (info && info.sourceGuildId === EMERGENCY_REVERT_GUILD) {
          try {
            await guild.bans.remove(userId, `Emergency revert of bans from ${EMERGENCY_REVERT_GUILD}`);
            delete data.users[userId];
            revertedCount++;
            console.log(`Reverted ${userId} in ${guild.name}`);
          } catch (err) { /* Not banned or missing perms */ }
        }
      }
    }
    saveData(data);
    await client.destroy();
    process.exit(0);
  }

  // ---------- MODE 2: GLOBAL UNBAN ----------
  if (GLOBAL_UNBAN_USER_ID) {
    console.log(`GLOBAL UNBAN requested for user ${GLOBAL_UNBAN_USER_ID}`);
    let unbanned = 0;
    for (const guild of guilds) {
      if (unbanned >= UNBAN_LIMIT) break;
      try {
        await guild.bans.remove(GLOBAL_UNBAN_USER_ID, `Global unban requested`);
        unbanned++;
        if (data.users[GLOBAL_UNBAN_USER_ID]) delete data.users[GLOBAL_UNBAN_USER_ID];
        console.log(`Unbanned ${GLOBAL_UNBAN_USER_ID} in ${guild.name}`);
      } catch (err) { /* Not banned */ }
    }
    saveData(data);
    await client.destroy();
    process.exit(0);
  }

  // ---------- MODE 3: NORMAL SYNC ----------
  console.log("Starting normal ban sync sequence.");

  // Step 1: Scan and Record
  for (const guild of guilds) {
    if (data.blockedGuilds && data.blockedGuilds.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => {
        // Record if the user is new OR we are missing the source server's name
        if (!data.users[ban.user.id] || !data.users[ban.user.id].sourceGuildName) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name, // Saved for ban reason permanence
            timestamp: Date.now()
          };
        }
      });
      console.log(`Synced ${bans.size} bans from ${guild.name}`);
    } catch (err) {
      console.error(`Fetch failed for ${guild.name}:`, err.message);
    }
  }

  // Step 2: Apply Bans across Alliance
  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch (err) { continue; }

    for (const userId of Object.keys(data.users)) {
      if (existing.has(userId)) continue;

      const info = data.users[userId];
      const sourceName = info.sourceGuildName || "Unknown Partner";
      const reason = `Partner ban: ${sourceName} (${info.sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name} (Source: ${sourceName})`);
      } catch (err) { /* Hierarchy/Permission error */ }
    }
  }

  saveData(data);
  console.log("Sync sequence complete. Shutting down.");
  
  await client.destroy();
  process.exit(0);
}

// Start the process
main().catch(err => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
