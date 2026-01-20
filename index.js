const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const BAN_REASON = "Banned in a partner server. United Group Alliance.";

const DATA_FILE = "./bans.json";

// ===== emergency config =====
// set this to a guild ID to revert ALL bans caused by that guild
// set to null for normal operation
const EMERGENCY_REVERT_GUILD = null;
// ============================

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {}, blockedGuilds: [] }, null, 2));
}

const data = JSON.parse(fs.readFileSync(DATA_FILE));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guilds = [...client.guilds.cache.values()];

  // ===== EMERGENCY REVERT MODE =====
  if (EMERGENCY_REVERT_GUILD) {
    console.log(`EMERGENCY REVERT for guild ${EMERGENCY_REVERT_GUILD}`);

    for (const guild of guilds) {
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
