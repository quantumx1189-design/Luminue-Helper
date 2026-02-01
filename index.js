const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");

// --- 1. SETTINGS ---
const DATA_FILE = "/app/data/bans.json"; 
const MAIN_GUILD_ID = "1462251909879435454"; 
const MOD_ROLE_NAME = "Manager";
const TOKEN = process.env.DISCORD_TOKEN;
const ALLIANCE_NAME = "United Group Alliance";
const COMMAND_PREFIX = ":UGAGlobalUnban";

// --- 2. UTILITIES ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { users: {}, blockedGuilds: [] };
    try { 
        const content = fs.readFileSync(DATA_FILE, "utf8");
        return JSON.parse(content); 
    } catch (e) { 
        return { users: {}, blockedGuilds: [] }; 
    }
}

function saveData(data) {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) { 
        console.error("Critical: Save failed:", e.message); 
    }
}

// --- 3. SYNC ENGINE ---
async function runFullSync(client) {
    console.log(">>> [LOG] Starting Scheduled Full Sync...");
    const data = loadData();
    const guilds = Array.from(client.guilds.cache.values());
    const unbanQueue = [];

    // Step A: Collect data and find owners
    for (const guild of guilds) {
        try {
            const bans = await guild.bans.fetch({ limit: 1000 });
            const currentBanIds = Array.from(bans.keys());

            for (const [userId, ban] of bans) {
                if (!data.users[userId]) {
                    data.users[userId] = {
                        sourceGuildId: guild.id,
                        sourceGuildName: guild.name,
                        reason: ban.reason || "No reason provided",
                        timestamp: Date.now()
                    };
                }
            }

            // Detect Unbans from Source
            for (const [userId, info] of Object.entries(data.users)) {
                if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
                    console.log(`[Sync] Source Unban detected: ${userId} on ${guild.name}`);
                    unbanQueue.push(userId);
                    delete data.users[userId];
                }
            }
        } catch (err) {
            console.error(`Skipping ${guild.name}: Permission denied.`);
        }
    }

    // Step B: Apply actions
    for (const guild of guilds) {
        // Process Unbans
        for (const userId of unbanQueue) {
            try { 
                await guild.bans.remove(userId, `Alliance Sync: Source Unban.`); 
                await sleep(300); 
            } catch (e) {}
        }
        
        // Process Bans
        const existing = await guild.bans.fetch().catch(() => new Map());
        for (const [userId, info] of Object.entries(data.users)) {
            if (existing.has(userId) || info.sourceGuildId === guild.id) continue;
            try {
                const reason = `Source: ${info.sourceGuildName} | Reason: ${info.reason}. ${ALLIANCE_NAME}`;
                await guild.bans.create(userId, { reason });
                await sleep(300);
            } catch (err) {
                if (err.status === 429) {
                    const retry = (err.rawError?.retry_after || 5) * 1000;
                    await sleep(retry);
                }
            }
        }
    }
    saveData(data);
    console.log(">>> [LOG] Full Sync Complete.");
}

// --- 4. THE MASTER WRAPPER ---
// This IIFE prevents "await" errors by ensuring the bot runs in an async context.
(async function() {
    if (!TOKEN) {
        console.error("Error: DISCORD_TOKEN is missing from environment variables.");
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

    // READY EVENT
    client.once("ready", async () => {
        console.log(`Successfully logged in as: ${client.user.tag}`);
        await runFullSync(client);
        // Sync every 6 hours
        setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
    });

    // GLOBAL UNBAN COMMAND
    client.on("messageCreate", async (message) => {
        if (message.author.bot || !message.content.startsWith(COMMAND_PREFIX)) return;
        if (message.guild.id !== MAIN_GUILD_ID) return;

        const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasManagerRole = message.member.roles.cache.some(role => role.name === MOD_ROLE_NAME);

        if (!isAdmin && !hasManagerRole) {
            return message.reply(`❌ Access Denied: Requires **${MOD_ROLE_NAME}** role.`);
        }

        const args = message.content.trim().split(/\s+/);
        const targetId = args[1];
        if (!targetId || isNaN(targetId)) return message.reply(`⚠️ Usage: \`${COMMAND_PREFIX} <UserID>\``);

        const statusMsg = await message.reply(`🔄 Processing global appeal for \`${targetId}\`...`);
        const data = loadData();
        let successCount = 0;
        
        if (data.users[targetId]) {
            delete data.users[targetId];
            saveData(data);
        }

        for (const guild of client.guilds.cache.values()) {
            try {
                await guild.bans.remove(targetId, `Global Appeal: ${message.author.tag}`);
                successCount++;
                await sleep(300);
            } catch (err) {}
        }

        await statusMsg.edit(`✅ **Global Unban Complete.** User removed from **${successCount}** servers.`);
    });

    // LIVE BAN EVENT
    client.on("guildBanAdd", async (ban) => {
        const data = loadData();
        if (data.users[ban.user.id]) return; 

        data.users[ban.user.id] = {
            sourceGuildId: ban.guild.id,
            sourceGuildName: ban.guild.name,
            reason: ban.reason || "No reason",
            timestamp: Date.now()
        };
        saveData(data);

        for (const [id, guild] of client.guilds.cache) {
            if (id === ban.guild.id) continue;
            try {
                await sleep(300);
                await guild.bans.create(ban.user.id, { 
                    reason: `Source: ${ban.guild.name} | Reason: ${ban.reason || "None"} | ${ALLIANCE_NAME}` 
                });
            } catch (e) {}
        }
    });

    // LIVE UNBAN EVENT
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
                    await guild.bans.remove(ban.user.id, `Source Unban Sync.`); 
                } catch (e) {}
            }
        }
    });

    // STARTUP
    try {
        await client.login(TOKEN);
    } catch (err) {
        console.error("Login Error:", err.message);
    }
})();
