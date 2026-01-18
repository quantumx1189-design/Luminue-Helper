const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans
  ]
});

const TOKEN = process.env.BOT_TOKEN;

async function main() {
  await client.login(TOKEN);

  console.log(`Logged in as ${client.user.tag}`);

  const guilds = await client.guilds.fetch();

  for (const [, guildPreview] of guilds) {
    const guild = await client.guilds.fetch(guildPreview.id);
    const bans = await guild.bans.fetch();

    console.log(`${guild.name}: ${bans.size} bans`);
  }

  console.log("Done. Exiting.");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
