const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

const BAN_REASON = "Banned in a partner server. Blacklisted from United Group Alliance.";
const UNBAN_REASON = "Unblacklisted from the United Group Alliance";

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

  // -------- REGISTER SLASH COMMAND --------
  const command = new SlashCommandBuilder()
    .setName("global-unban")
    .setDescription("Unban a user from all partner servers")
    .addStringOption(opt =>
      opt.setName("user_id")
        .setDescription("The Discord user ID to unban")
        .setRequired(true)
    );

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: [command.toJSON()] }
  );

  console.log("Slash command registered");

  // -------- HANDLE COMMAND --------
  client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "global-unban") return;

    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({
        content: "You need **Ban Members** permission to use this.",
        ephemeral: true
      });
    }

    const userId = interaction.options.getString("user_id");
    let success = 0;
    let failed = 0;

    for (const guild of client.guilds.cache.values()) {
      try {
        await guild.members.unban(userId, UNBAN_REASON);
        success++;
      } catch {
        failed++;
      }
    }

    await interaction.reply({
      content: `Global unban complete.\nUnbanned in ${success} servers.\nFailed in ${failed} servers.`,
      ephemeral: true
    });
  });

  // -------- BAN SYNC (ONE SHOT) --------
  const guilds = Array.from(client.guilds.cache.values());
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
          console.error(`Failed banning ${userId} in ${guild.name}: ${err.message}`);
        }
      }
    }
  }

  console.log("Ban sync complete. Bot staying online for commands.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});    } catch (err) {
      console.error(`Failed fetching bans from ${guild.name}: ${err.message}`);
    }
  }

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
          console.error(`Failed banning ${userId} in ${guild.name}: ${err.message}`);
        }
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
});
