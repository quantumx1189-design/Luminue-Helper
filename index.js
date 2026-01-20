// index.js
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

// Config — via environment variables (strings)
const EMERGENCY_REVERT_GUILD = process.env.EMERGENCY_REVERT_GUILD || null;
// global unban of a single user id (string). Leave unset/null for normal operation.
const GLOBAL_UNBAN_USER_ID = process.env.GLOBAL_UNBAN_USER_ID || null;
// Max number of unbans to perform when GLOBAL_UNBAN_USER_ID is set (integer)
const UNBAN_LIMIT = parseInt(process.env.UNBAN_LIMIT || "100", 10);
// When emergency revert is used, cap the number of unbans performed (optional)
const REVERT_LIMIT = parseInt(process.env.REVERT_LIMIT || "1000", 10);

// Alliance label for reasons
const ALLIANCE_NAME = "United Group Alliance";

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

    // iterate through guilds and for each user that matches sourceGuild, unban
    for (const guild of guilds) {
      // iterate keys to avoid mutation during loop
      const userIds = Object.keys(data.users);
      for (const userId of userIds) {
        if (revertedCount >= REVERT_LIMIT) {
          console.log(`Revert limit reached (${REVERT_LIMIT}). Stopping.`);
          break;
        }
        const info = data.users[userId];
        if (!info) continue;
        if (info.sourceGuildId === EMERGENCY_REVERT_GUILD) {
          try {
            await guild.bans.remove(userId, `Emergency revert of bans from ${EMERGENCY_REVERT_GUILD}`);
            // remove provenance entry so it won't be re-applied later
            delete data.users[userId];
            revertedCount++;
            console.log(`Reverted ${userId} in ${guild.name}`);
          } catch (err) {
            // ignore per-guild failure (not banned / no perms)
          }
        }
      }
      if (revertedCount >= REVERT_LIMIT) break;
    }

    saveData(data);
    console.log(`Emergency revert complete. Total unbans attempted: ${revertedCount}`);
    await client.destroy();
    process.exit(0);
  }

  // ---------- GLOBAL UNBAN MODE (single user) ----------
  if (GLOBAL_UNBAN_USER_ID) {
    console.log(`GLOBAL UNBAN requested for user ${GLOBAL_UNBAN_USER_ID} (limit ${UNBAN_LIMIT})`);
    let unbanned = 0;
    for (const guild of guilds) {
      if (unbanned >= UNBAN_LIMIT) {
        console.log(`Unban limit ${UNBAN_LIMIT} reached. Stopping further unbans.`);
        break;
      }
      try {
        await guild.bans.remove(GLOBAL_UNBAN_USER_ID, `Global unban requested (limit ${UNBAN_LIMIT})`);
        unbanned++;
        // If that user was tracked in provenance, remove them
        if (data.users[GLOBAL_UNBAN_USER_ID]) {
          delete data.users[GLOBAL_UNBAN_USER_ID];
        }
        console.log(`Unbanned ${GLOBAL_UNBAN_USER_ID} in ${guild.name}`);
      } catch (err) {
        // ignore per-guild failures
      }
    }
    saveData(data);
    console.log(`Global unban run finished. Successful unbans: ${unbanned}`);
    await client.destroy();
    process.exit(0);
  }

  // ---------- NORMAL SYNC MODE ----------
  console.log("Starting normal ban sync (collect provenance from trusted guilds).");

  // Step 1: collect bans from trusted guilds (skip blockedGuilds)
  for (const guild of guilds) {
    if (Array.isArray(data.blockedGuilds) && data.blockedGuilds.includes(guild.id)) {
      console.log(`Skipping blocked guild ${guild.name} (${guild.id})`);
      continue;
    }

    try {
      const bans = await guild.bans.fetch();
      for (const ban of bans.values()) {
        // record the first source guild for provenance
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            timestamp: Date.now()
          };
        }
      }
      console.log(`Synced ${Object.keys(bans || {}).length || 0} bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name} (${guild.id}):`, err && err.message ? err.message : err);
    }
  }

  // Step 2: apply bans to all guilds using provenance, include source name in reason
  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch (err) {
      console.error(`Failed fetching existing bans for ${guild.name} (${guild.id}):`, err && err.message ? err.message : err);
      continue;
    }

    for (const userId of Object.keys(data.users)) {
      if (existing.has(userId)) continue;

      const sourceGuildId = data.users[userId].sourceGuildId;
      const sourceGuild = client.guilds.cache.get(sourceGuildId);
      const reason = sourceGuild
        ? `Banned in partner server: ${sourceGuild.name} (${sourceGuildId}). ${ALLIANCE_NAME}.`
        : `Banned in partner server: Unknown (${sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name} (source ${sourceGuildId})`);
      } catch (err) {
        // Likely permission/hierarchy issue; log and continue
        console.error(`Failed to ban ${userId} in ${guild.name}:`, err && err.message ? err.message : err);
      }
    }
  }

  // Save provenance changes
  saveData(data);

  console.log("Normal ban sync complete. Exiting.");
  try {
    await client.destroy();
  } catch (err) {
    // ignore
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err && err.stack ? err.stack : err);
  process.exit(1);
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

    // iterate through guilds and for each user that matches sourceGuild, unban
    for (const guild of guilds) {
      // iterate keys to avoid mutation during loop
      const userIds = Object.keys(data.users);
      for (const userId of userIds) {
        if (revertedCount >= REVERT_LIMIT) {
          console.log(`Revert limit reached (${REVERT_LIMIT}). Stopping.`);
          break;
        }
        const info = data.users[userId];
        if (!info) continue;
        if (info.sourceGuildId === EMERGENCY_REVERT_GUILD) {
          try {
            await guild.bans.remove(userId, `Emergency revert of bans from ${EMERGENCY_REVERT_GUILD}`);
            // remove provenance entry so it won't be re-applied later
            delete data.users[userId];
            revertedCount++;
            console.log(`Reverted ${userId} in ${guild.name}`);
          } catch (err) {
            // ignore per-guild failure (not banned / no perms)
          }
        }
      }
      if (revertedCount >= REVERT_LIMIT) break;
    }

    saveData(data);
    console.log(`Emergency revert complete. Total unbans attempted: ${revertedCount}`);
    await client.destroy();
    process.exit(0);
  }

  // ---------- GLOBAL UNBAN MODE (single user) ----------
  if (GLOBAL_UNBAN_USER_ID) {
    console.log(`GLOBAL UNBAN requested for user ${GLOBAL_UNBAN_USER_ID} (limit ${UNBAN_LIMIT})`);
    let unbanned = 0;
    for (const guild of guilds) {
      if (unbanned >= UNBAN_LIMIT) {
        console.log(`Unban limit ${UNBAN_LIMIT} reached. Stopping further unbans.`);
        break;
      }
      try {
        await guild.bans.remove(GLOBAL_UNBAN_USER_ID, `Global unban requested (limit ${UNBAN_LIMIT})`);
        unbanned++;
        // If that user was tracked in provenance, remove them
        if (data.users[GLOBAL_UNBAN_USER_ID]) {
          delete data.users[GLOBAL_UNBAN_USER_ID];
        }
        console.log(`Unbanned ${GLOBAL_UNBAN_USER_ID} in ${guild.name}`);
      } catch (err) {
        // ignore per-guild failures
      }
    }
    saveData(data);
    console.log(`Global unban run finished. Successful unbans: ${unbanned}`);
    await client.destroy();
    process.exit(0);
  }

  // ---------- NORMAL SYNC MODE ----------
  console.log("Starting normal ban sync (collect provenance from trusted guilds).");

  // Step 1: collect bans from trusted guilds (skip blockedGuilds)
  for (const guild of guilds) {
    if (Array.isArray(data.blockedGuilds) && data.blockedGuilds.includes(guild.id)) {
      console.log(`Skipping blocked guild ${guild.name} (${guild.id})`);
      continue;
    }

    try {
      const bans = await guild.bans.fetch();
      for (const ban of bans.values()) {
        // record the first source guild for provenance
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            timestamp: Date.now()
          };
        }
      }
      console.log(`Synced ${Object.keys(bans || {}).length || 0} bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name} (${guild.id}):`, err && err.message ? err.message : err);
    }
  }

  // Step 2: apply bans to all guilds using provenance, include source name in reason
  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch (err) {
      console.error(`Failed fetching existing bans for ${guild.name} (${guild.id}):`, err && err.message ? err.message : err);
      continue;
    }

    for (const userId of Object.keys(data.users)) {
      if (existing.has(userId)) continue;

      const sourceGuildId = data.users[userId].sourceGuildId;
      const sourceGuild = client.guilds.cache.get(sourceGuildId);
      const reason = sourceGuild
        ? `Banned in partner server: ${sourceGuild.name} (${sourceGuildId}). ${ALLIANCE_NAME}.`
        : `Banned in partner server: Unknown (${sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name} (source ${sourceGuildId})`);
      } catch (err) {
        // Likely permission/hierarchy issue; log and continue
        console.error(`Failed to ban ${userId} in ${guild.name}:`, err && err.message ? err.message : err);
      }
    }
  }

  // Save provenance changes
  saveData(data);

  console.log("Normal ban sync complete. Exiting.");
  try {
    await client.destroy();
  } catch (err) {
    // ignore
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err && err.stack ? err.stack : err);
  process.exit(1);
});  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      for (const ban of bans.values()) {
        // Only record first source to avoid overwrite wars
        if (!bannedUsers[ban.user.id]) {
          bannedUsers[ban.user.id] = {
            sourceGuildId: guild.id
          };
        }
      }
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}: ${err.message}`);
    }
  }

  // STEP 2: Apply missing bans to all other guilds
  for (const guild of guilds) {
    let existingBans;
    try {
      existingBans = await guild.bans.fetch();
    } catch {
      continue;
    }

    for (const userId of Object.keys(bannedUsers)) {
      if (existingBans.has(userId)) continue;

      const sourceGuildId = bannedUsers[userId].sourceGuildId;
      const sourceGuild = client.guilds.cache.get(sourceGuildId);

      const reason = sourceGuild
        ? `Banned in partner server: ${sourceGuild.name} (${sourceGuildId}). ${ALLIANCE_NAME}.`
        : `Banned in partner server: Unknown (${sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Banned ${userId} in ${guild.name}`);
      } catch (err) {
        console.error(`Failed banning ${userId} in ${guild.name}: ${err.message}`);
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
});    for (const guild of guilds) {
      for (const [userId, info] of Object.entries(data.users)) {
        if (info.sourceGuild === EMERGENCY_REVERT_GUILD) {
          try {
            await guild.bans.remove(userId);
            delete data.users[userId];
            console.log(`Unbanned ${userId} in ${guild.name}`);
          } catch {}
        }
      }
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log("Emergency revert complete.");
    process.exit(0);
  }
  // ================================

  // collect bans from trusted guilds
  for (const guild of guilds) {
    if (data.blockedGuilds.includes(guild.id)) {
      console.log(`Skipping blocked guild ${guild.name}`);
      continue;
    }

    try {
      const bans = await guild.bans.fetch();
      for (const ban of bans.values()) {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuild: guild.id,
            timestamp: Date.now()
          };
        }
      }
      console.log(`Synced bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}`);
    }
  }

  // apply bans
  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch {
      continue;
    }

    for (const userId of Object.keys(data.users)) {
      if (!existing.has(userId)) {
        try {
          await guild.members.ban(userId, { reason: BAN_REASON });
          console.log(`Banned ${userId} in ${guild.name}`);
        } catch {}
      }
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log("Ban sync complete.");
  process.exit(0);
});

client.login(TOKEN);    for (const guild of guilds) {
      try {
        await guild.members.unban(GLOBAL_UNBAN_USER_ID);
        console.log(`Unbanned in ${guild.name}`);
      } catch (err) {
        // Ignore: not banned or no perms
      }
    }
  }

  // -------- COLLECT ALL BANS --------
  const bannedUsers = new Set();

  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      for (const ban of bans.values()) {
        bannedUsers.add(ban.user.id);
      }
      console.log(`Fetched bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}: ${err.message}`);
    }
  }

  // -------- APPLY BANS EVERYWHERE --------
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
          // Ignore permission / hierarchy issues
        }
      }
    }
  }

  console.log("Ban sync complete. Exiting.");
  await client.destroy();
  process.exit(0);
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
