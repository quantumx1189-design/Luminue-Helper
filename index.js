const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN.");
  process.exit(1);
}

const DATA_FILE = path.resolve(__dirname, "bans.json");
const ALLIANCE_NAME = "United Group Alliance";

// --- Helpers ---
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, blockedGuilds: [] };
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Main ---
async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
  });

  await client.login(TOKEN);
  await new Promise(resolve => client.once("ready", resolve));
  console.log(`Logged in as ${client.user.tag}`);

  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());
  const unbanQueue = []; // Users to be removed from all servers

  // ---------- STEP 1: SYNC BANS & DETECT UNBANS ----------
  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      const currentBanIds = Array.from(bans.keys());

      // A. Check for NEW bans
      bans.forEach(ban => {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            timestamp: Date.now()
          };
          console.log(`New ban detected: ${ban.user.tag} in ${guild.name}`);
        }
      });

      // B. Check for UNBANS (If user is in JSON for this guild but NOT in the live ban list)
      for (const [userId, info] of Object.entries(data.users)) {
        if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
          console.log(`Unban detected at source: ${userId} was unbanned from ${guild.name}`);
          unbanQueue.push(userId);
          delete data.users[userId]; // Remove from our database
        }
      }
    } catch (err) {
      console.error(`Failed to sync ${guild.name}:`, err.message);
    }
  }

  // ---------- STEP 2: APPLY UPDATES TO ALL GUILDS ----------
  for (const guild of guilds) {
    // 1. Process Unbans (Remove bans for anyone in the unbanQueue)
    for (const userId of unbanQueue) {
      try {
        await guild.bans.remove(userId, `Source unban sync: ${ALLIANCE_NAME}`);
        console.log(`Unbanned ${userId} in ${guild.name} (Synced)`);
      } catch (err) { /* Not banned here, ignore */ }
    }

    // 2. Process New Bans (Apply bans from our database)
    const existingBans = await guild.bans.fetch().catch(() => new Map());
    for (const [userId, info] of Object.entries(data.users)) {
      if (existingBans.has(userId)) continue;

      const sourceName = info.sourceGuildName || "Unknown Partner";
      const reason = `Partner ban: ${sourceName}. ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Banned ${userId} in ${guild.name} (Source: ${sourceName})`);
      } catch (err) { /* Permission error */ }
    }
  }

  saveData(data);
  console.log("Full sync (Bans & Unbans) complete.");
  await client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
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
