const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");

// --- 1. CONFIGURATION ---
const DATA_FILE = "/app/data/bans.json"; 
const MAIN_GUILD_ID = "1462251909879435454"; 
const MOD_ROLE_NAME = "Manager";
const TOKEN = process.env.DISCORD_TOKEN;
const ALLIANCE_NAME = "United Group Alliance";
const COMMAND_PREFIX = ":UGAGlobalUnban";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 2. DATA MANAGEMENT ---
function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { users: {}, blockedGuilds: [] };
    try { 
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); 
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
        console.error("Save failed:", e.message); 
    }
}

// --- 3. SYNC ENGINE ---
async function runFullSync(client) {
    console.log(">>> [LOG] Running Scheduled Sync...");
    const data = loadData();
    const guilds = Array.from(client.guilds.cache.values());
    const unbanQueue = [];

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

            for (const [userId, info] of Object.entries(data.users)) {
                if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
                    console.log(`[Unban] Source ${guild.name} cleared ${userId}.`);
                    unbanQueue.push(userId);
                    delete data.users[userId];
                }
            }
        } catch (err) {
            console.error(`Fetch failed for ${guild.name}: ${err.message}`);
        }
    }

    for (const guild of guilds) {
        for (const userId of unbanQueue) {
            try { 
                await guild.bans.remove(userId, `Sync: Source Unban.`); 
                await sleep(250); 
            } catch (e) {}
        }
        
        const existing = await guild.bans.fetch().catch(() => new Map());
        for (const [userId, info] of Object.entries(data.users)) {
            if (existing.has(userId) || info.sourceGuildId === guild.id) continue;
            try {
                const reason = `Source: ${info.sourceGuildName} | Reason: ${info.reason}. ${ALLIANCE_NAME}`;
                await guild.bans.create(userId, { reason });
                await sleep(250);
            } catch (err) {
                if (err.status === 429) await sleep((err.rawError?.retry_after || 5) * 1000);
            }
        }
    }
    saveData(data);
}

// --- 4. MAIN EXECUTION WRAPPER ---
(async () => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.GuildModeration,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    // Event: Ready
    client.once("ready", async () => {
        console.log(`Bot active: ${client.user.tag}`);
        await runFullSync(client);
        setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
    });

    // Event: Global Unban Command
    client.on("messageCreate", async (message) => {
        if (message.author.bot || !message.content.startsWith(COMMAND_PREFIX)) return;
        if (message.guild.id !== MAIN_GUILD_ID) return;

        const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasManagerRole = message.member.roles.cache.some(role => role.name === MOD_ROLE_NAME);

        if (!isAdmin && !hasManagerRole) {
            return message.reply(`❌ Access Denied. Requires **${MOD_ROLE_NAME}** role.`);
        }

        const args = message.content.trim().split(/\s+/);
        const targetId = args[1];
        if (!targetId) return message.reply(`⚠️ Usage: \`${COMMAND_PREFIX} <UserID>\``);

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
                await sleep(250);
            } catch (err) {}
        }

        await statusMsg.edit(`✅ **Global Unban Complete.** User unbanned from **${successCount}** servers.`);
    });

    // Event: Live Ban
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
                await sleep(250);
                await guild.bans.create(ban.user.id, { 
                    reason: `Source: ${ban.guild.name} | Reason: ${ban.reason || "None"} | ${ALLIANCE_NAME}` 
                });
            } catch (e) {}
        }
    });

    // Event: Live Unban
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
                    await guild.bans.remove(ban.user.id, `Source Unban Sync.`); 
                } catch (e) {}
            }
        }
    });

    // Login
    try {
        await client.login(TOKEN);
    } catch (err) {
        console.error("Login Error:", err.message);
    }
})();
    console.log(">>> [LOG] Running Scheduled Sync...");
    const data = loadData();
    const guilds = Array.from(client.guilds.cache.values());
    const unbanQueue = [];

    for (const guild of guilds) {
        try {
            const bans = await guild.bans.fetch({ limit: 1000 });
            const currentBanIds = Array.from(bans.keys());

            // FIX: Using for...of instead of .forEach to allow 'continue'
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

            for (const [userId, info] of Object.entries(data.users)) {
                if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
                    console.log(`[Unban] Source ${guild.name} cleared ${userId}.`);
                    unbanQueue.push(userId);
                    delete data.users[userId];
                }
            }
        } catch (err) { /* Catching potential permission errors */ }
    }

    for (const guild of guilds) {
        for (const userId of unbanQueue) {
            try { 
                await guild.bans.remove(userId, `Sync: Source Unban.`); 
                await sleep(250); 
            } catch (e) {}
        }
        
        const existing = await guild.bans.fetch().catch(() => new Map());
        for (const [userId, info] of Object.entries(data.users)) {
            if (existing.has(userId) || info.sourceGuildId === guild.id) continue;
            try {
                const reason = `Source: ${info.sourceGuildName} | Reason: ${info.reason}. ${ALLIANCE_NAME}`;
                await guild.bans.create(userId, { reason });
                await sleep(250);
            } catch (err) {
                if (err.status === 429) await sleep((err.rawError?.retry_after || 5) * 1000);
            }
        }
    }
    saveData(data);
}

// --- CLIENT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- EVENT LISTENERS ---

client.once("ready", async () => {
    console.log(`Bot active: ${client.user.tag}`);
    await runFullSync(client);
    setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith(COMMAND_PREFIX)) return;
    if (message.guild.id !== MAIN_GUILD_ID) return;

    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasManagerRole = message.member.roles.cache.some(role => role.name === MOD_ROLE_NAME);

    if (!isAdmin && !hasManagerRole) {
        return message.reply(`❌ Access Denied. Requires **${MOD_ROLE_NAME}** role or Administrator permissions.`);
    }

    const args = message.content.trim().split(/\s+/);
    const targetId = args[1];
    if (!targetId) return message.reply(`⚠️ Usage: \`${COMMAND_PREFIX} <UserID>\``);

    const statusMsg = await message.reply(`🔄 Processing global appeal for \`${targetId}\`...`);
    const data = loadData();
    let successCount = 0;
    
    if (data.users[targetId]) {
        delete data.users[targetId];
        saveData(data);
    }

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.bans.remove(targetId, `Global Appeal Granted via command by ${message.author.tag}`);
            successCount++;
            await sleep(250);
        } catch (err) { /* Silent fail if not banned */ }
    }

    await statusMsg.edit(`✅ **Global Unban Complete.**\nUser \`${targetId}\` scrubbed from database and unbanned from **${successCount}** servers.`);
});

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
            await sleep(250);
            await guild.bans.create(ban.user.id, { 
                reason: `Source: ${ban.guild.name} | Reason: ${ban.reason || "None"} | ${ALLIANCE_NAME}` 
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
            try { 
                await sleep(250); 
                await guild.bans.remove(ban.user.id, `Source Unban Sync.`); 
            } catch (e) {}
        }
    }
});

// --- EXECUTION START ---
async function startBot() {
    try {
        await client.login(TOKEN);
    } catch (err) {
        console.error("Failed to start bot:", err);
    }
}

startBot();
    console.log(">>> [LOG] Running Scheduled Sync...");
    const data = loadData();
    const guilds = Array.from(client.guilds.cache.values());
    const unbanQueue = [];

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

            for (const [userId, info] of Object.entries(data.users)) {
                if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
                    console.log(`[Unban] Source ${guild.name} cleared ${userId}.`);
                    unbanQueue.push(userId);
                    delete data.users[userId];
                }
            }
        } catch (err) { /* Catching potential permission errors */ }
    }

    for (const guild of guilds) {
        for (const userId of unbanQueue) {
            try { 
                await guild.bans.remove(userId, `Sync: Source Unban.`); 
                await sleep(250); 
            } catch (e) {}
        }
        
        const existing = await guild.bans.fetch().catch(() => new Map());
        for (const [userId, info] of Object.entries(data.users)) {
            if (existing.has(userId) || info.sourceGuildId === guild.id) continue;
            try {
                const reason = `Source: ${info.sourceGuildName} | Reason: ${info.reason}. ${ALLIANCE_NAME}`;
                await guild.bans.create(userId, { reason });
                await sleep(250);
            } catch (err) {
                if (err.status === 429) await sleep((err.rawError?.retry_after || 5) * 1000);
            }
        }
    }
    saveData(data);
}

// --- CLIENT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- EVENT LISTENERS ---

client.once("ready", async () => {
    console.log(`Bot active: ${client.user.tag}`);
    await runFullSync(client);
    setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith(COMMAND_PREFIX)) return;
    if (message.guild.id !== MAIN_GUILD_ID) return;

    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasManagerRole = message.member.roles.cache.some(role => role.name === MOD_ROLE_NAME);

    if (!isAdmin && !hasManagerRole) {
        return message.reply(`❌ Access Denied. Requires **${MOD_ROLE_NAME}** role or Administrator permissions.`);
    }

    const args = message.content.split(" ");
    const targetId = args[1];
    if (!targetId) return message.reply(`⚠️ Usage: \`${COMMAND_PREFIX} <UserID>\``);

    const statusMsg = await message.reply(`🔄 Processing global appeal for \`${targetId}\`...`);
    const data = loadData();
    let successCount = 0;
    
    if (data.users[targetId]) {
        delete data.users[targetId];
        saveData(data);
    }

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.bans.remove(targetId, `Global Appeal Granted via command by ${message.author.tag}`);
            successCount++;
            await sleep(250);
        } catch (err) { /* Silent fail if not banned */ }
    }

    await statusMsg.edit(`✅ **Global Unban Complete.**\nUser \`${targetId}\` scrubbed from database and unbanned from **${successCount}** servers.`);
});

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
            await sleep(250);
            await guild.bans.create(ban.user.id, { 
                reason: `Source: ${ban.guild.name} | Reason: ${ban.reason || "None"} | ${ALLIANCE_NAME}` 
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
            try { 
                await sleep(250); 
                await guild.bans.remove(ban.user.id, `Source Unban Sync.`); 
            } catch (e) {}
        }
    }
});

// --- EXECUTION START ---
async function startBot() {
    try {
        await client.login(TOKEN);
    } catch (err) {
        console.error("Failed to start bot:", err);
    }
}

startBot();
        if (data.blockedGuilds?.includes(guild.id)) continue;
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

            for (const [userId, info] of Object.entries(data.users)) {
                if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
                    console.log(`[Unban] Source ${guild.name} cleared ${userId}.`);
                    unbanQueue.push(userId);
                    delete data.users[userId];
                }
            }
        } catch (err) { /* Catching potential permission errors */ }
    }

    for (const guild of guilds) {
        for (const userId of unbanQueue) {
            try { await guild.bans.remove(userId, `Sync: Source Unban.`); await sleep(250); } catch (e) {}
        }
        
        const existing = await guild.bans.fetch().catch(() => new Map());
        for (const [userId, info] of Object.entries(data.users)) {
            if (existing.has(userId) || info.sourceGuildId === guild.id) continue;
            try {
                const reason = `Source: ${info.sourceGuildName} | Reason: ${info.reason}. ${ALLIANCE_NAME}`;
                await guild.bans.create(userId, { reason });
                await sleep(250);
            } catch (err) {
                if (err.status === 429) await sleep((err.rawError?.retry_after || 5) * 1000);
            }
        }
    }
    saveData(data);
}

// --- CLIENT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once("ready", async () => {
    console.log(`Bot active: ${client.user.tag}`);
    await runFullSync(client);
    setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

// --- SECURE COMMAND LISTENER ---
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith(COMMAND_PREFIX)) return;
    if (message.guild.id !== MAIN_GUILD_ID) return;

    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasManagerRole = message.member.roles.cache.some(role => role.name === MOD_ROLE_NAME);

    if (!isAdmin && !hasManagerRole) {
        return message.reply(`❌ Access Denied. Requires **${MOD_ROLE_NAME}** role or Administrator permissions.`);
    }

    const args = message.content.split(" ");
    const targetId = args[1];
    if (!targetId) return message.reply(`⚠️ Usage: \`${COMMAND_PREFIX} <UserID>\``);

    const statusMsg = await message.reply(`🔄 Processing global appeal for \`${targetId}\`...`);
    const data = loadData();
    let successCount = 0;
    
    if (data.users[targetId]) {
        delete data.users[targetId];
        saveData(data);
    }

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.bans.remove(targetId, `Global Appeal Granted via command by ${message.author.tag}`);
            successCount++;
            await sleep(250);
        } catch (err) { /* Silent fail if not banned */ }
    }

    await statusMsg.edit(`✅ **Global Unban Complete.**\nUser \`${targetId}\` scrubbed from database and unbanned from **${successCount}** servers.`);
});

// --- LIVE LISTENERS ---
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
            await sleep(250);
            await guild.bans.create(ban.user.id, { 
                reason: `Source: ${ban.guild.name} | Reason: ${ban.reason || "None"} | ${ALLIANCE_NAME}` 
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
            try { await sleep(250); await guild.bans.remove(ban.user.id, `Source Unban Sync.`); } catch (e) {}
        }
    }
});

client.login(TOKEN);
            await guild.bans.create(ban.user.id, { 
                reason: `Source: ${ban.guild.name} | Reason: ${ban.reason || "None"} | ${ALLIANCE_NAME}` 
            });
        } catch (e) {}
    }
});

client.on("guildBanRemove", async (ban) => {
    const data = loadData();
    const info = data.users[ban.user.id];
    
    // Automatic sync ONLY respects the original Source Server.
    // The !unban command overrides this.
    if (info && info.sourceGuildId === ban.guild.id) {
        delete data.users[ban.user.id];
        saveData(data);
        for (const [id, guild] of client.guilds.cache) {
            if (id === ban.guild.id) continue;
            try { await sleep(250); await guild.bans.remove(ban.user.id, `Source Unban Sync.`); } catch (e) {}
        }
    }
});

client.login(TOKEN);
            for (const [userId, ban] of bans) {
                // If we already know the source, don't change it.
                if (data.users[userId]) continue;

                // If new, record this guild as a 'candidate' source
                data.users[userId] = {
                    sourceGuildId: guild.id,
                    sourceGuildName: guild.name,
                    reason: ban.reason || "No reason provided",
                    timestamp: Date.now() // Ideally, we'd fetch audit logs here, but that's heavy.
                };
                console.log(`[Source Locked] ${userId} assigned to ${guild.name}`);
            }

            // Sync Unbans: Only if this guild is the registered owner
            for (const [userId, info] of Object.entries(data.users)) {
                if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
                    console.log(`[Unban] Original source ${guild.name} cleared ${userId}.`);
                    unbanQueue.push(userId);
                    delete data.users[userId];
                }
            }
        } catch (err) { console.error(`Failed guild ${guild.name}:`, err.message); }
    }

    // Apply bans to others
    for (const guild of guilds) {
        // Handle unbans first
        for (const userId of unbanQueue) {
            try { await guild.bans.remove(userId, `Alliance Sync: Source Unban.`); await sleep(300); } catch (e) {}
        }

        const existing = await guild.bans.fetch().catch(() => new Map());
        for (const [userId, info] of Object.entries(data.users)) {
            if (existing.has(userId) || info.sourceGuildId === guild.id) continue;

            try {
                const reason = `Source: ${info.sourceGuildName} | Reason: ${info.reason} | ${ALLIANCE_NAME}`;
                await guild.bans.create(userId, { reason });
                await sleep(300);
            } catch (err) {
                if (err.status === 429) await sleep((err.rawError?.retry_after || 5) * 1000);
            }
        }
    }
    saveData(data);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
});

client.once("ready", async () => {
    console.log(`Bot active: ${client.user.tag}`);
    await runFullSync(client);
    setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
});

// Live events are the most accurate source detection
client.on("guildBanAdd", async (ban) => {
    const data = loadData();
    // If we already have a source for this user, a "secondary" ban just happened. Ignore it.
    if (data.users[ban.user.id]) return;

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
                reason: `Source: ${ban.guild.name} | Reason: ${ban.reason || "None"} | ${ALLIANCE_NAME}` 
            });
        } catch (e) {}
    }
});

client.on("guildBanRemove", async (ban) => {
    const data = loadData();
    const info = data.users[ban.user.id];
    // ONLY unban everywhere if the guild that just unbanned them is the original source.
    if (info && info.sourceGuildId === ban.guild.id) {
        delete data.users[ban.user.id];
        saveData(data);
        for (const [id, guild] of client.guilds.cache) {
            if (id === ban.guild.id) continue;
            try { await sleep(300); await guild.bans.remove(ban.user.id, `Source Unban Sync.`); } catch (e) {}
        }
    }
});

client.login(TOKEN);
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
