  // ---------- NORMAL SYNC MODE ----------
  console.log("Starting normal ban sync.");

  // Step 1: Collect bans and record BOTH ID and Name
  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => {
        // Record if the user isn't tracked OR if we are missing the source name
        if (!data.users[ban.user.id] || !data.users[ban.user.id].sourceGuildName) {
          data.users[ban.user.id] = {
            sourceGuildId: guild.id,
            sourceGuildName: guild.name, // NEW: Capture the server name
            timestamp: Date.now()
          };
        }
      });
      console.log(`Synced ${bans.size} bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}:`, err.message);
    }
  }

  // Step 2: Apply bans using the saved name from your JSON data
  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch (err) { continue; }

    for (const userId of Object.keys(data.users)) {
      if (existing.has(userId)) continue;

      const info = data.users[userId];
      
      // Use the saved name from our JSON; fallback to cache or 'Unknown'
      const sourceName = info.sourceGuildName || "Unknown Partner";
      const reason = `Partner ban: ${sourceName} (${info.sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name} (Source: ${sourceName})`);
      } catch (err) {
        // Likely a hierarchy/permission issue
      }
    }
  }

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to write bans.json:", err);
  }
}

/**
 * Main Logic Wrapper
 */
async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
  });

  client.on("error", (e) => console.error("Discord client error:", e));

  await client.login(TOKEN);
  await new Promise(resolve => client.once("ready", resolve));

  console.log(`Logged in as ${client.user.tag}`);

  const data = loadData();
  const guilds = Array.from(client.guilds.cache.values());

  // ---------- EMERGENCY REVERT MODE ----------
  if (EMERGENCY_REVERT_GUILD) {
    console.log(`EMERGENCY REVERT: undo bans that originated from guild ${EMERGENCY_REVERT_GUILD}`);
    let revertedCount = 0;

    for (const guild of guilds) {
      const userIds = Object.keys(data.users);
      for (const userId of userIds) {
        if (revertedCount >= REVERT_LIMIT) break;
        
        const info = data.users[userId];
        if (info && info.sourceGuildId === EMERGENCY_REVERT_GUILD) {
          try {
            await guild.bans.remove(userId, `Emergency revert of bans from ${EMERGENCY_REVERT_GUILD}`);
            delete data.users[userId];
            revertedCount++;
            console.log(`Reverted ${userId} in ${guild.name}`);
          } catch (err) { /* ignore if not banned */ }
        }
      }
    }

    saveData(data);
    console.log(`Emergency revert complete. Total unbans attempted: ${revertedCount}`);
    await client.destroy();
    process.exit(0);
  }

  // ---------- GLOBAL UNBAN MODE ----------
  if (GLOBAL_UNBAN_USER_ID) {
    console.log(`GLOBAL UNBAN requested for user ${GLOBAL_UNBAN_USER_ID}`);
    let unbanned = 0;
    for (const guild of guilds) {
      if (unbanned >= UNBAN_LIMIT) break;
      try {
        await guild.bans.remove(GLOBAL_UNBAN_USER_ID, `Global unban requested`);
        unbanned++;
        if (data.users[GLOBAL_UNBAN_USER_ID]) delete data.users[GLOBAL_UNBAN_USER_ID];
        console.log(`Unbanned ${GLOBAL_UNBAN_USER_ID} in ${guild.name}`);
      } catch (err) { /* ignore */ }
    }
    saveData(data);
    await client.destroy();
    process.exit(0);
  }

  // ---------- NORMAL SYNC MODE ----------
  console.log("Starting normal ban sync.");

  for (const guild of guilds) {
    if (data.blockedGuilds?.includes(guild.id)) continue;

    try {
      const bans = await guild.bans.fetch();
      bans.forEach(ban => {
        if (!data.users[ban.user.id]) {
          data.users[ban.user.id] = { sourceGuildId: guild.id, timestamp: Date.now() };
        }
      });
      console.log(`Synced ${bans.size} bans from ${guild.name}`);
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}:`, err.message);
    }
  }

  for (const guild of guilds) {
    let existing;
    try {
      existing = await guild.bans.fetch();
    } catch (err) { continue; }

    for (const userId of Object.keys(data.users)) {
      if (existing.has(userId)) continue;

      const sourceGuildId = data.users[userId].sourceGuildId;
      const sourceGuild = client.guilds.cache.get(sourceGuildId);
      const reason = `Partner ban: ${sourceGuild ? sourceGuild.name : "Unknown"} (${sourceGuildId}). ${ALLIANCE_NAME}.`;

      try {
        await guild.members.ban(userId, { reason });
        console.log(`Applied ban for ${userId} in ${guild.name}`);
      } catch (err) { /* ignore permission errors */ }
    }
  }

  saveData(data);
  console.log("Sync complete.");
  await client.destroy();
  process.exit(0);
}

// CRITICAL: Ensure you DO NOT put 'await' before main() here.
main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
