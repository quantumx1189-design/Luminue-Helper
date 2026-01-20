const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

// --- Configuration ---
const TOKEN = process.env.DISCORD_TOKEN;
const DATA_FILE = path.resolve(__dirname, "bans.json");
const ALLIANCE_NAME = "United Group Alliance";

if (!TOKEN) {
  console.error("Error: DISCORD_TOKEN is not set in environment variables.");
  process.exit(1);
}

// --- Data Persistence Helpers ---
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { users: {}, blockedGuilds: [] };
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading bans.json, returning empty state.");
    return { users: {}, blockedGuilds: [] };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save bans.json:", err);
  }
}

// --- Core Logic: Full Sync ---
async function runFullSync(client) {
  console.log(">>> Starting Periodic Full Sync...");
  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());
  const unbanQueue = [];

  // Step 1: Scan all guilds for new bans and source unbans
  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      const currentBanIds = Array.from(bans.keys());

      // Find New Bans
      bans.forEach(ban => {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            timestamp: Date.now()
          };
          console.log(`[Sync] Found new ban: ${ban.user.tag} in ${guild.name}`);
        }
      });

      // Find Source Unbans (User is in JSON for this guild, but not in Discord's list)
      for (const [userId, info] of Object.entries(data.users)) {
        if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
          console.log(`[Sync] Source Unban detected: ${userId} in ${guild.name}`);
          unbanQueue.push(userId);
          delete data.users[userId];
        }
      }
    } catch (err) {
      console.error(`[Sync] Could not fetch bans for ${guild.name}:`, err.message);
    }
  }

  // Step 2: Apply updates to all guilds
  for (const guild of guilds) {
    // Apply Unbans
    for (const userId of unbanQueue) {
      try {
        await guild.bans.remove(userId, `Sync: Unbanned at source. ${ALLIANCE_NAME}.`);
      } catch (e) { /* Not banned here */ }
    }

    // Apply New Bans
    for (const [userId, info] of Object.entries(data.users)) {
      try {
        const reason = `Partner ban: ${info.sourceGuildName || "Unknown"}. ${ALLIANCE_NAME}.`;
        await guild.bans.create(userId, { reason });
      } catch (e) { /* Permission issue or already banned */ }
    }
  }

  saveData(data);
  console.log(">>> Full Sync Complete.");
}

// --- Bot Client Setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

// Initial Startup
client.once("clientReady", async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Serving ${readyClient.guilds.cache.size} guilds.`);
  
  // Perform a full sync immediately on startup
  await runFullSync(readyClient);
  
  // Set interval to sync every 6 hours (backup for missed events)
  setInterval(() => runFullSync(readyClient), 6 * 60 * 60 * 1000);
});

// --- Live Listeners ---

// Listen for New Bans
client.on("guildBanAdd", async (ban) => {
  const data = loadData();
  if (data.blockedGuilds?.includes(ban.guild.id)) return;

  console.log(`[Live] New Ban: ${ban.user.tag} in ${ban.guild.name}`);
  
  data.users[ban.user.id] = {
    sourceGuildId: ban.guild.id,
    sourceGuildName: ban.guild.name,
    timestamp: Date.now()
  };
  saveData(data);

  // Propagate to all other guilds
  const otherGuilds = client.guilds.cache.filter(g => g.id !== ban.guild.id);
  for (const [id, guild] of otherGuilds) {
    try {
      await guild.bans.create(ban.user.id, { 
        reason: `Partner ban: ${ban.guild.name}. ${ALLIANCE_NAME}.` 
      });
    } catch (e) { /* Lack of permission */ }
  }
});

// Listen for Unbans
client.on("guildBanRemove", async (ban) => {
  const data = loadData();
  const info = data.users[ban.user.id];

  // Only trigger global unban if the unban happened at the original source
  if (info && info.sourceGuildId === ban.guild.id) {
    console.log(`[Live] Source Unban: ${ban.user.tag} from ${ban.guild.name}`);
    delete data.users[ban.user.id];
    saveData(data);

    const otherGuilds = client.guilds.cache.filter(g => g.id !== ban.guild.id);
    for (const [id, guild] of otherGuilds) {
      try {
        await guild.bans.remove(ban.user.id, `Source unban: ${ban.guild.name}. ${ALLIANCE_NAME}.`);
      } catch (e) { /* Not banned here */ }
    }
  }
});

// Handle errors to keep the process alive
client.on("error", console.error);

client.login(TOKEN);
    const guilds = client.guilds.cache.filter(g => g.id !== ban.guild.id);
    for (const [id, guild] of guilds) {
      try {
        await guild.bans.remove(ban.user.id, `Live Sync: Unbanned at source.`);
      } catch (e) {}
    }
  }
});

client.login(TOKEN);
