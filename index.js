const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

// --- 1. CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN;
const DATA_FILE = path.resolve(__dirname, "bans.json");
const ALLIANCE_NAME = "United Group Alliance";

if (!TOKEN) {
  console.error("Error: DISCORD_TOKEN is missing. Please set it in Fly.io secrets.");
  process.exit(1);
}

// Helper: Sleep function to prevent rate limits (throttling)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 2. DATA PERSISTENCE ---
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, blockedGuilds: [] };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    return { users: {}, blockedGuilds: [] };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save bans.json");
  }
}

// --- 3. CORE SYNC LOGIC ---
async function runFullSync(client) {
  console.log(">>> [START] Reliable Full Sync (Throttled)...");
  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());
  const unbanQueue = [];

  // Step A: Collect data from all servers
  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;
    try {
      const bans = await guild.bans.fetch({ limit: 1000 });
      const currentBanIds = Array.from(bans.keys());

      // Update local database with new bans
      bans.forEach(ban => {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            timestamp: Date.now()
          };
        }
      });

      // Detect if someone was unbanned at the source
      for (const [userId, info] of Object.entries(data.users)) {
        if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
          unbanQueue.push(userId);
          delete data.users[userId];
        }
      }
    } catch (err) {
      console.error(`[Fetch Error] ${guild.name}: ${err.message}`);
    }
  }

  // Step B: Apply updates with throttling to avoid capacity/rate limit issues
  for (const guild of guilds) {
    console.log(`Processing ${guild.name}...`);

    // Process Unbans
    for (const userId of unbanQueue) {
      try {
        await guild.bans.remove(userId, `Sync: Source Unban. ${ALLIANCE_NAME}.`);
        await sleep(300); // 0.3s pause
      } catch (e) {}
    }

    // Process Bans
    // We fetch current bans again per-server to avoid duplicate API calls
    const existing = await guild.bans.fetch().catch(() => new Map());
    for (const [userId, info] of Object.entries(data.users)) {
      if (existing.has(userId)) continue;

      try {
        const reason = `Partner ban: ${info.sourceGuildName || "Unknown"}. ${ALLIANCE_NAME}.`;
        await guild.bans.create(userId, { reason });
        console.log(`Banned ${userId} in ${guild.name}`);
        await sleep(300); // 0.3s pause between actions
      } catch (err) {
        if (err.status === 429) {
          const retry = (err.rawError?.retry_after || 5) * 1000;
          console.warn(`Capacity reached. Cooling down for ${retry}ms...`);
          await sleep(retry);
        }
      }
    }
  }

  saveData(data);
  console.log(">>> [FINISH] Reliable Sync Complete.");
}

// --- 4. INITIALIZE CLIENT (ONLY ONCE!) ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

// --- 5. EVENT LISTENERS ---

client.once("ready", async (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}`);
  
  // Start initial sync
  await runFullSync(readyClient);
  
  // Set to run every 6 hours
  setInterval(() => runFullSync(readyClient), 6 * 60 * 60 * 1000);
});

// Live listener for new bans
client.on("guildBanAdd", async (ban) => {
  const data = loadData();
  if (data.blockedGuilds?.includes(ban.guild.id)) return;

  data.users[ban.user.id] = {
    sourceGuildId: ban.guild.id,
    sourceGuildName: ban.guild.name,
    timestamp: Date.now()
  };
  saveData(data);

  // Propagate live
  for (const [id, guild] of client.guilds.cache) {
    if (id === ban.guild.id) continue;
    try {
      await sleep(300);
      await guild.bans.create(ban.user.id, { 
        reason: `Live Sync: ${ban.guild.name}. ${ALLIANCE_NAME}.` 
      });
    } catch (e) {}
  }
});

// Live listener for unbans
client.on("guildBanRemove", async (ban) => {
  const data = loadData();
  const info = data.users[ban.user.id];

  if (info && info.sourceGuildId === ban.guild.id) {
    delete data.users[ban.user.id];
    saveData(data);

    for (const [id, guild] of client.guilds.cache) {
      if (id === ban.guild.id) continue;
      try {
        await sleep(300);
        await guild.bans.remove(ban.user.id, `Live Sync: Source Unban. ${ALLIANCE_NAME}.`);
      } catch (e) {}
    }
  }
});

// Final login
client.login(TOKEN).catch(console.error);
