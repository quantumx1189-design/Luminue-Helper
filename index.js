const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

// Use the persistent path for Fly.io Volumes
const DATA_FILE = "/app/data/bans.json"; 
const TOKEN = process.env.DISCORD_TOKEN;
const ALLIANCE_NAME = "United Group Alliance";

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN.");
  process.exit(1);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, blockedGuilds: [] };
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) { return { users: {}, blockedGuilds: [] }; }
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

async function runFullSync(client) {
  console.log(">>> [START] Smart Syncing Reasons and Sources...");
  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());
  const unbanQueue = [];

  // Step 1: Scan and identify ownership
  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;
    try {
      const bans = await guild.bans.fetch({ limit: 1000 });
      const currentBanIds = Array.from(bans.keys());

      bans.forEach(ban => {
        // ONLY set the source if we don't already have one for this user
        // This prevents "random" servers from taking over ownership
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            reason: ban.reason || "No reason provided", // Capture the REAL original reason
            timestamp: Date.now()
          };
          console.log(`[New Record] ${ban.user.tag} belongs to source: ${guild.name}`);
        }
      });

      // Check for unbans only for users OWNED by this guild
      for (const [userId, info] of Object.entries(data.users)) {
        if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
          console.log(`[Unban Detect] Source ${guild.name} unbanned ${userId}. Queueing global unban.`);
          unbanQueue.push(userId);
          delete data.users[userId];
        }
      }
    } catch (err) {
      console.error(`Error scanning ${guild.name}: ${err.message}`);
    }
  }

  // Step 2: Apply bans using the ORIGINAL reason
  for (const guild of guilds) {
    for (const userId of unbanQueue) {
      try { await guild.bans.remove(userId, `Source Unban Sync. ${ALLIANCE_NAME}.`); await sleep(300); } catch (e) {}
    }

    const existing = await guild.bans.fetch().catch(() => new Map());
    for (const [userId, info] of Object.entries(data.users)) {
      if (existing.has(userId) || info.sourceGuildId === guild.id) continue;

      try {
        // Use the original reason found at the source!
        const reason = `Original Reason: ${info.reason} | Source: ${info.sourceGuildName}. ${ALLIANCE_NAME}.`;
        await guild.bans.create(userId, { reason });
        console.log(`[Synced] Banned ${userId} in ${guild.name} with original reason.`);
        await sleep(300);
      } catch (err) {
        if (err.status === 429) await sleep((err.rawError?.retry_after || 5) * 1000);
      }
    }
  }

  saveData(data);
  console.log(">>> [FINISH] Smart Sync Complete.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
});

client.once("ready", async () => {
  console.log(`Bot online: ${client.user.tag}`);
  await runFullSync(client);
  setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

// Live Listeners remain the same but use info.reason
client.on("guildBanAdd", async (ban) => {
  const data = loadData();
  if (data.blockedGuilds?.includes(ban.guild.id)) return;

  // Store the actual reason from the audit log
  data.users[ban.user.id] = {
    sourceGuildId: ban.guild.id,
    sourceGuildName: ban.guild.name,
    reason: ban.reason || "No reason provided",
    timestamp: Date.now()
  };
  saveData(data);

  for (const [id, guild] of client.guilds.cache) {
    if (id === ban.guild.id) continue;
    try {
      await sleep(300);
      await guild.bans.create(ban.user.id, { 
        reason: `Original Reason: ${ban.reason || "None"} | Source: ${ban.guild.name}. ${ALLIANCE_NAME}.` 
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
    for (const [id, guild] of client.guilds.cache) {
      if (id === ban.guild.id) continue;
      try { await sleep(300); await guild.bans.remove(ban.user.id, `Source Unban Sync.`); } catch (e) {}
    }
  }
});

client.login(TOKEN).catch(console.error);
