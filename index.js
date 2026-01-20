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
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    return { users: {}, blockedGuilds: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Logic Functions ---

async function runFullSync(client) {
  console.log("--- Starting Full Alliance Sync ---");
  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());
  const unbanQueue = [];

  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;
    try {
      const bans = await guild.bans.fetch();
      const currentBanIds = Array.from(bans.keys());

      // Detect New Bans
      bans.forEach(ban => {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            timestamp: Date.now()
          };
        }
      });

      // Detect Unbans at Source
      for (const [userId, info] of Object.entries(data.users)) {
        if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
          unbanQueue.push(userId);
          delete data.users[userId];
        }
      }
    } catch (err) {
      console.error(`Sync error for ${guild.name}:`, err.message);
    }
  }

  // Apply changes to all guilds
  for (const guild of guilds) {
    for (const userId of unbanQueue) {
      try { await guild.bans.remove(userId, `Sync: Unbanned at source.`); } catch (e) {}
    }
    for (const [userId, info] of Object.entries(data.users)) {
      try {
        const reason = `Partner ban: ${info.sourceGuildName}. ${ALLIANCE_NAME}.`;
        await guild.bans.create(userId, { reason });
      } catch (e) {}
    }
  }
  
  saveData(data);
  console.log("--- Full Sync Complete ---");
}

// --- Main Bot Process ---

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildModeration
  ]
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Perform initial sync on startup
  await runFullSync(client);
  
  // Optional: Run a full sync every 6 hours just to be safe
  setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

// LIVE SYNC: When someone gets banned
client.on("guildBanAdd", async (ban) => {
  const data = loadData();
  if (data.blockedGuilds?.includes(ban.guild.id)) return;

  console.log(`Live Ban: ${ban.user.tag} in ${ban.guild.name}`);
  
  data.users[ban.user.id] = {
    sourceGuildId: ban.guild.id,
    sourceGuildName: ban.guild.name,
    timestamp: Date.now()
  };
  saveData(data);

  // Propagate to other guilds
  const guilds = client.guilds.cache.filter(g => g.id !== ban.guild.id);
  for (const [id, guild] of guilds) {
    try {
      await guild.bans.create(ban.user.id, { 
        reason: `Live Sync: Banned in ${ban.guild.name}. ${ALLIANCE_NAME}.` 
      });
    } catch (e) {}
  }
});

// LIVE SYNC: When someone gets unbanned
client.on("guildBanRemove", async (ban) => {
  const data = loadData();
  const info = data.users[ban.user.id];

  // Only sync unban if it happened in the ORIGINAL source server
  if (info && info.sourceGuildId === ban.guild.id) {
    console.log(`Live Unban: ${ban.user.tag} unbanned from source ${ban.guild.name}`);
    delete data.users[ban.user.id];
    saveData(data);

    const guilds = client.guilds.cache.filter(g => g.id !== ban.guild.id);
    for (const [id, guild] of guilds) {
      try {
        await guild.bans.remove(ban.user.id, `Live Sync: Unbanned at source.`);
      } catch (e) {}
    }
  }
});

client.login(TOKEN);
