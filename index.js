const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

const ALLIANCE_NAME = "United Group Alliance";

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration
    ]
  });

  await client.login(TOKEN);
  await new Promise(resolve => client.once("ready", resolve));

  console.log(`Logged in as ${client.user.tag}`);

  const guilds = Array.from(client.guilds.cache.values());

  /**
   * bannedUsers structure:
   * {
   *   userId: {
   *     sourceGuildId: string
   *   }
   * }
   */
  const bannedUsers = {};

  // STEP 1: Collect bans + where they came from
  for (const guild of guilds) {
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
