const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans
  ]
});

// CONFIG
const TOKEN = process.env.BOT_TOKEN; // your bot token in Fly secrets
const MAIN_GUILD_ID = "1221977896135168080";

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(MAIN_GUILD_ID);

    // THIS is where your await is now legal
    const bans = await guild.bans.fetch();
    console.log(`Fetched ${bans.size} bans from main guild`);

    // Example loop (does nothing yet, just proves it works)
    for (const [userId, ban] of bans) {
      console.log(`Banned user: ${userId}`);
    }

  } catch (err) {
    console.error("Error during ban fetch:", err);
  }
});

client.login(TOKEN);
  // Map of userId -> count of guilds banning them
  const banCount = new Map();

  // Fetch bans from every guild
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();
      console.log(`Fetched ${bans.size} bans from ${guild.name}`);

      bans.forEach(ban => {
        banCount.set(ban.user.id, (banCount.get(ban.user.id) || 0) + 1);
      });
    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}:`, err.message);
    }
  }

  // Apply bans and unbans
  for (const guild of guilds) {
    try {
      const bans = await guild.bans.fetch();

      // Ban users banned elsewhere
      for (const [userId] of banCount) {
        if (!bans.has(userId)) {
          try {
            await guild.members.ban(userId, { reason: BAN_REASON });
            console.log(`Banned ${userId} in ${guild.name}`);
          } catch (err) {
            console.error(`Failed banning ${userId} in ${guild.name}:`, err.message);
          }
        }
      }

      // Unban users banned nowhere
      for (const ban of bans.values()) {
        if (!banCount.has(ban.user.id)) {
          try {
            await guild.members.unban(ban.user.id, { reason: UNBAN_REASON });
            console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
          } catch (err) {
            console.error(`Failed unbanning ${ban.user.id} in ${guild.name}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error(`Failed syncing ${guild.name}:`, err.message);
    }
  }

  await client.destroy();
}

/**
 * Wait for Discord ready event
 */
function waitForReady(client) {
  if (client.readyAt) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Discord ready timeout"));
    }, 30000);

    client.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });

    client.once("error", err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));    console.log(`Logged in as ${client.user.tag}. Discovering guilds...`);

    const guilds = [...client.guilds.cache.values()];

    // Build ban counts: userId -> number of servers that ban them
    const banCount = new Map();

    // Fetch bans from each guild (serial to keep rate limits sane)
    for (const guild of guilds) {
      try {
        const bans = await guild.bans.fetch();
        bans.forEach((ban) => {
          banCount.set(ban.user.id, (banCount.get(ban.user.id) || 0) + 1);
        });
        console.log(`Fetched ${bans.size} bans from ${guild.name}`);
      } catch (err) {
        console.error(`Failed fetching bans from ${guild.name} (${guild.id}):`, extractErrMsg(err));
      }
    }

    // Now apply bans/unbans in each guild
    for (const guild of guilds) {
      try {
        const bans = await guild.bans.fetch();
        // Apply bans (if someone is banned somewhere, ensure they are banned here)
        for (const [userId, count] of banCount.entries()) {
          if (count > 0 && !bans.has(userId)) {
            try {
              await guild.members.ban(userId, { reason: BAN_REASON });
              console.log(`Banned ${userId} in ${guild.name}`);
            } catch (err) {
              console.error(`Failed to ban ${userId} in ${guild.name}:`, extractErrMsg(err));
            }
          }
        }

        // Apply unbans (if someone is banned nowhere, unban here)
        for (const ban of bans.values()) {
          if (!banCount.has(ban.user.id)) {
            try {
              await guild.members.unban(ban.user.id, { reason: UNBAN_REASON });
              console.log(`Unbanned ${ban.user.id} in ${guild.name}`);
            } catch (err) {
              console.error(`Failed to unban ${ban.user.id} in ${guild.name}:`, extractErrMsg(err));
            }
          }
        }
      } catch (err) {
        console.error(`Failed syncing bans/unbans for ${guild.name} (${guild.id}):`, extractErrMsg(err));
      }
    }

  } finally {
    // Always attempt to destroy client quietly
    try {
      await client.destroy();
    } catch (e) {
      // nothing
    }
  }
}

// Helper: wait for client ready with promise
function onceReady(client) {
  if (client.readyAt) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("error", onError);
    }
    client.once("ready", onReady);
    client.once("error", onError);
    // safety timer in case ready never fires
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Discord client did not become ready in time"));
    }, 30_000);
  });
}

function extractErrMsg(err) {
  try {
    if (!err) return String(err);
    if (err.message) return err.message;
    return String(err);
  } catch {
    return "Unknown error";
  }
}

// Graceful shutdown handlers (in case Fly sends SIGTERM)
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
