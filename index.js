const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN (set as Fly secret).");
  process.exit(1);
}

const DATA_FILE = path.resolve(__dirname, "bans.json");

// Config
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

// --- Main Logic ---

async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
  });

  client.on("error", (e) => console.error("Discord client error:", e));

  await client.login(TOKEN);
  await new Promise(resolve => client.once("ready", resolve));

  console.log(`Logged in as ${client.user.tag}`);

  // FIX: This definition must exist here for the rest of the script to work
  const guilds = Array.from(client.guilds.cache.values());
  const data = loadData();

  // ---------- EMERGENCY REVERT MODE ----------
  if (EMERGENCY_REVERT_GUILD) {
    console.log(`EMERGENCY REVERT: undo bans from guild ${EMERGENCY_REVERT_GUILD}`);
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
          } catch (err) { /* ignore */ }
        }
      }
    }
    saveData(data);
    await client.destroy();
    process.exit(0);
  }

  // ---------- GLOBAL UNBAN MODE ----------
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
      } catch (err) { /* ignore */ }
    }
    saveData(data);
    await client.destroy();
    process.exit(0);
  }

  // ---------- NORMAL SYNC MODE ----------
  console.log("Starting normal ban sync.");

  // Step 1: Sync bans FROM trusted guilds INTO our database
  for (const guild of guilds) {
    // Skip if guild is in blocked list
    if (data.blockedGuilds && data.blockedGuilds.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => {
        // If user is new OR we don't have the server name yet, update the record
        if (!data.users[ban.user.id] || !data.users[ban.user.id].sourceGuildName) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name, // Save name permanently
            timestamp: Date.now()
          };
        }
      });
      console.log(`Synced ${bans.size} bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}:`, err.message);
    }
  }

  // Step 2: Apply bans TO all guilds
  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch (err) { continue; }

    for (const userId of Object.keys(data.users)) {
      // If already banned, skip
      if (existing.has(userId)) continue;

      const info = data.users[userId];
      
      // Use saved name if available, otherwise "Unknown"
      const sourceName = info.sourceGuildName || "Unknown Partner";
      const reason = `Partner ban: ${sourceName} (${info.sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name} (Source: ${sourceName})`);
      } catch (err) {
        // Ignore permission errors (e.g. trying to ban server owner/admin)
      }
    }
  }

  saveData(data);
  console.log("Sync complete.");
  
  await client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
      
      // Use the saved name from our JSON; fallback to cache or 'Unknown'
      const sourceName = info.sourceGuildName || "Unknown Partner";
      const reason = `Partner ban: ${sourceName} (${info.sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name} (Source: ${sourceName})`);
      } catch (err) {
        // Likely a hierarchy/permission issue
      }
    }
  }

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to write bans.json:", err);
  }
}

/**
 * Main Logic Wrapper
 */
async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
  });

  client.on("error", (e) => console.error("Discord client error:", e));

  await client.login(TOKEN);
  await new Promise(resolve => client.once("ready", resolve));

  console.log(`Logged in as ${client.user.tag}`);

  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());

  // ---------- EMERGENCY REVERT MODE ----------
  if (EMERGENCY_REVERT_GUILD) {
    console.log(`EMERGENCY REVERT: undo bans that originated from guild ${EMERGENCY_REVERT_GUILD}`);
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
          } catch (err) { /* ignore if not banned */ }
        }
      }
    }

    saveData(data);
    console.log(`Emergency revert complete. Total unbans attempted: ${revertedCount}`);
    await client.destroy();
    process.exit(0);
  }

  // ---------- GLOBAL UNBAN MODE ----------
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
      } catch (err) { /* ignore */ }
    }
    saveData(data);
    await client.destroy();
    process.exit(0);
  }

  // ---------- NORMAL SYNC MODE ----------
  console.log("Starting normal ban sync.");

  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = { sourceGuildId: guild.id, timestamp: Date.now() };
        }
      });
      console.log(`Synced ${bans.size} bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}:`, err.message);
    }
  }

  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch (err) { continue; }

    for (const userId of Object.keys(data.users)) {
      if (existing.has(userId)) continue;

      const sourceGuildId = data.users[userId].sourceGuildId;
      const sourceGuild = client.guilds.cache.get(sourceGuildId);
      const reason = `Partner ban: ${sourceGuild ? sourceGuild.name : "Unknown"} (${sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name}`);
      } catch (err) { /* ignore permission errors */ }
    }
  }

  saveData(data);
  console.log("Sync complete.");
  await client.destroy();
  process.exit(0);
}

// CRITICAL: Ensure you DO NOT put 'await' before main() here.
main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
