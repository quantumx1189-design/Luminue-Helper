const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const DATA_FILE = path.resolve(__dirname, "bans.json");
const ALLIANCE_NAME = "United Group Alliance";

if (!TOKEN) {
  console.error("Error: DISCORD_TOKEN is missing.");
  process.exit(1);
}

// Helper: Sleep function to prevent rate limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, blockedGuilds: [] };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    return { users: {}, blockedGuilds: [] };
  }
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (err) {}
}

async function runFullSync(client) {
  console.log(">>> [START] Reliable Full Sync...");
  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());
  const unbanQueue = [];

  // Step 1: Collection
  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;
    try {
      const bans = await guild.bans.fetch({ limit: 1000 }); // Fetch up to 1000
      const currentBanIds = Array.from(bans.keys());

      bans.forEach(ban => {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            timestamp: Date.now()
          };
        }
      });

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

  // Step 2: Application with Throttling
  for (const guild of guilds) {
    console.log(`Processing ${guild.name}...`);

    // Process Unbans
    for (const userId of unbanQueue) {
      try {
        await guild.bans.remove(userId, `Sync: Source Unban. ${ALLIANCE_NAME}.`);
        await sleep(250); // Small pause to respect Discord
      } catch (e) {}
    }

    // Process Bans
    const existing = await guild.bans.fetch().catch(() => new Map());
    for (const [userId, info] of Object.entries(data.users)) {
      if (existing.has(userId)) continue;

      try {
        const reason = `Partner ban: ${info.sourceGuildName || "Unknown"}. ${ALLIANCE_NAME}.`;
        await guild.bans.create(userId, { reason });
        console.log(`Successfully banned ${userId} in ${guild.name}`);
        await sleep(250); // Pause for 1/4 second between each ban
      } catch (err) {
        if (err.status === 429) {
          const retryAfter = err.rawError?.retry_after || 5;
          console.warn(`Rate limited! Waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000);
        }
      }
    }
  }

  saveData(data);
  console.log(">>> [FINISH] Reliable Sync Complete.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
});

client.once("ready", async () => {
  console.log(`Bot Online: ${client.user.tag}`);
  await runFullSync(client);
  setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

// Live Event: Ban
client.on("guildBanAdd", async (ban) => {
  const data = loadData();
  if (data.blockedGuilds?.includes(ban.guild.id)) return;

  data.users[ban.user.id] = {
    sourceGuildId: ban.guild.id,
    sourceGuildName: ban.guild.name,
    timestamp: Date.now()
  };
  saveData(data);

  for (const [id, guild] of client.guilds.cache) {
    if (id === ban.guild.id) continue;
    try {
      await sleep(250); 
      await guild.bans.create(ban.user.id, { reason: `Live Sync: ${ban.guild.name}. ${ALLIANCE_NAME}.` });
    } catch (e) {}
  }
});

// Live Event: Unban
client.on("guildBanRemove", async (ban) => {
  const data = loadData();
  const info = data.users[ban.user.id];

  if (info && info.sourceGuildId === ban.guild.id) {
    delete data.users[ban.user.id];
    saveData(data);

    for (const [id, guild] of client.guilds.cache) {
      if (id === ban.guild.id) continue;
      try {
        await sleep(250);
        await guild.bans.remove(ban.user.id, `Live Sync: Source Unban. ${ALLIANCE_NAME}.`);
      } catch (e) {}
    }
  }
});

client.login(TOKEN).catch(console.error);
// --- Core Logic: Full Sync ---
async function runFullSync(client) {
  console.log(">>> Starting Periodic Full Sync...");
  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());
  const unbanQueue = [];

  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      const currentBanIds = Array.from(bans.keys());

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

  for (const guild of guilds) {
    for (const userId of unbanQueue) {
      try {
        await guild.bans.remove(userId, `Sync: Unbanned at source. ${ALLIANCE_NAME}.`);
      } catch (e) {}
    }

    for (const [userId, info] of Object.entries(data.users)) {
      try {
        const reason = `Partner ban: ${info.sourceGuildName || "Unknown"}. ${ALLIANCE_NAME}.`;
        await guild.bans.create(userId, { reason });
      } catch (e) {}
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

// --- Event Listeners ---

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Perform a full sync immediately on startup
  await runFullSync(client);
  
  // Set interval to sync every 6 hours
  setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

client.on("guildBanAdd", async (ban) => {
  const data = loadData();
  if (data.blockedGuilds?.includes(ban.guild.id)) return;

  data.users[ban.user.id] = {
    sourceGuildId: ban.guild.id,
    sourceGuildName: ban.guild.name,
    timestamp: Date.now()
  };
  saveData(data);

  const otherGuilds = client.guilds.cache.filter(g => g.id !== ban.guild.id);
  for (const [id, guild] of otherGuilds) {
    try {
      await guild.bans.create(ban.user.id, { 
        reason: `Partner ban: ${ban.guild.name}. ${ALLIANCE_NAME}.` 
      });
    } catch (e) {}
  }
});

client.on("guildBanRemove", async (ban) => {
  const data = loadData();
  const info = data.users[ban.user.id];

  if (info && info.sourceGuildId === ban.guild.id) {
    delete data.users[ban.user.id];
    saveData(data);

    const otherGuilds = client.guilds.cache.filter(g => g.id !== ban.guild.id);
    for (const [id, guild] of otherGuilds) {
      try {
        await guild.bans.remove(ban.user.id, `Source unban: ${ban.guild.name}. ${ALLIANCE_NAME}.`);
      } catch (e) {}
    }
  }
});

// --- Start the Bot ---
// This uses .catch to avoid the top-level await issue entirely
client.login(TOKEN).catch(err => {
  console.error("Failed to login to Discord:", err);
  process.exit(1);
});
