{
  "name": "ban-sync-bot",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "discord.js": "^14.14.1",
    "express": "^4.19.2"
  }
}async function runOnce() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration
    ]
  });

  await client.login(TOKEN);
  await onceReady(client);

  const guilds = [...client.guilds.cache.values()];
  const bannedSomewhere = new Set();

  // Collect bans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      bans.forEach(b => bannedSomewhere.add(b.user.id));
      console.log(`Fetched bans from ${guild.name}`);
    } catch (e) {
      console.error(`Failed fetching bans in ${guild.name}`, e.message);
    }
  }

  // Sync bans & unbans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();

      // Ban where missing
      for (const userId of bannedSomewhere) {
        if (!bans.has(userId)) {
          await guild.members.ban(userId, { reason: BAN_REASON });
          console.log(`Banned ${userId} in ${guild.name}`);
        }
      }

      // Unban where no longer banned anywhere
      for (const ban of bans.values()) {
        if (!bannedSomewhere.has(ban.user.id)) {
          await guild.members.unban(ban.user.id, UNBAN_REASON);
          console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
        }
      }

    } catch (e) {
      console.error(`Failed syncing ${guild.name}`, e.message);
    }
  }

  await client.destroy();
}

function onceReady(client) {
  if (client.readyAt) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject("Client ready timeout"), 30000);
    client.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));      const bans = await guild.bans.fetch();

      // Apply bans
      for (const [userId, count] of banCount) {
        if (count > 0 && !bans.has(userId)) {
          await guild.members.ban(userId, { reason: BAN_REASON });
          console.log(`Banned ${userId} in ${guild.name}`);
        }
      }

      // Apply unbans
      for (const ban of bans.values()) {
        if (!banCount.has(ban.user.id)) {
          await guild.members.unban(ban.user.id, { reason: UNBAN_REASON });
          console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
        }
      }

    } catch (err) {
      console.error(`Failed syncing bans/unbans for ${guild.name}`, err.message);
    }
  }

  console.log("Ban and unban sync complete. Shutting down.");
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN); the 
