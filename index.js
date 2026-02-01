const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, PermissionsBitField, Events } = require("discord.js");

const DATA_FILE = "/app/data/bans.json"; 
const MAIN_GUILD_ID = "1462251909879435454"; 
const MOD_ROLE_NAME = "Manager";
const TOKEN = process.env.DISCORD_TOKEN;
const ALLIANCE_NAME = "United Group Alliance";
const COMMAND_PREFIX = ":UGAGlobalUnban";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { users: {}, blockedGuilds: [] };
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } 
    catch (e) { return { users: {}, blockedGuilds: [] }; }
}

function saveData(data) {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Save failed:", e.message); }
}

async function runFullSync(client) {
    console.log(">>> [SYNC START] Building database...");
    const data = loadData();
    const guilds = Array.from(client.guilds.cache.values());
    const unbanQueue = [];

    for (const guild of guilds) {
        console.log(`[SCANNING] ${guild.name}...`); // Added progress tracking
        try {
            const bans = await guild.bans.fetch({ limit: 1000 });
            const currentBanIds = Array.from(bans.keys());

            for (const [userId, ban] of bans) {
                if (!data.users[userId]) {
                    data.users[userId] = {
                        sourceGuildId: guild.id,
                        sourceGuildName: guild.name,
                        reason: ban.reason || "No reason",
                        timestamp: Date.now()
                    };
                }
            }

            for (const [userId, info] of Object.entries(data.users)) {
                if (info.sourceGuildId === guild.id && !currentBanIds.includes(userId)) {
                    unbanQueue.push(userId);
                    delete data.users[userId];
                }
            }
        } catch (err) { console.log(`[SKIP] Missing perms in ${guild.name}`); }
        await sleep(500); // Slow down to prevent Discord API hits
    }

    console.log(`>>> [ACTION] Syncing ${unbanQueue.length} unbans and existing bans...`);
    for (const guild of guilds) {
        for (const userId of unbanQueue) {
            try { await guild.bans.remove(userId, `Sync: Source Unban.`); await sleep(400); } catch (e) {}
        }
        
        const existing = await guild.bans.fetch().catch(() => new Map());
        for (const [userId, info] of Object.entries(data.users)) {
            if (existing.has(userId) || info.sourceGuildId === guild.id) continue;
            try {
                await guild.bans.create(userId, { reason: `Source: ${info.sourceGuildName} | ${ALLIANCE_NAME}` });
                await sleep(400);
            } catch (err) {
                if (err.status === 429) await sleep((err.rawError?.retry_after || 5) * 1000);
            }
        }
    }
    saveData(data);
    console.log(">>> [SYNC COMPLETE] Alliance is protected.");
}

(async () => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.GuildModeration,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    // Updated to ClientReady to remove warning
    client.once(Events.ClientReady, async (c) => {
        console.log(`Ready! Logged in as ${c.user.tag}`);
        await runFullSync(client);
        setInterval(() => runFullSync(client), 6 * 60 * 60 * 1000);
    });

    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot || !message.content.startsWith(COMMAND_PREFIX)) return;
        if (message.guild.id !== MAIN_GUILD_ID) return;

        const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasRole = message.member.roles.cache.some(r => r.name === MOD_ROLE_NAME);
        if (!isAdmin && !hasRole) return message.reply("❌ Access Denied.");

        const targetId = message.content.trim().split(/\s+/)[1];
        if (!targetId || isNaN(targetId)) return message.reply("⚠️ Usage: `:UGAGlobalUnban <ID>`");

        const data = loadData();
        delete data.users[targetId];
        saveData(data);

        let count = 0;
        await message.channel.send(`🔄 Unbanning \`${targetId}\` from all servers...`);
        for (const guild of client.guilds.cache.values()) {
            try { await guild.bans.remove(targetId, `Global Appeal: ${message.author.tag}`); count++; await sleep(300); } catch (e) {}
        }
        message.reply(`✅ Successfully unbanned from **${count}** servers.`);
    });

    // Live events
    client.on(Events.GuildBanAdd, async (ban) => {
        const data = loadData();
        if (data.users[ban.user.id]) return;
        data.users[ban.user.id] = { sourceGuildId: ban.guild.id, sourceGuildName: ban.guild.name, reason: ban.reason || "None", timestamp: Date.now() };
        saveData(data);
        for (const [id, guild] of client.guilds.cache) {
            if (id === ban.guild.id) continue;
            try { await sleep(400); await guild.bans.create(ban.user.id, { reason: `Source: ${ban.guild.name} | ${ALLIANCE_NAME}` }); } catch (e) {}
        }
    });

    client.on(Events.GuildBanRemove, async (ban) => {
        const data = loadData();
        const info = data.users[ban.user.id];
        if (info && info.sourceGuildId === ban.guild.id) {
            delete data.users[ban.user.id];
            saveData(data);
            for (const [id, guild] of client.guilds.cache) {
                if (id === ban.guild.id) continue;
                try { await sleep(400); await guild.bans.remove(ban.user.id); } catch (e) {}
            }
        }
    });

    await client.login(TOKEN);
})();
