require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const fetch = require("node-fetch");
const http = require("http");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DATHOST_EMAIL = process.env.DATHOST_EMAIL;
const DATHOST_PASSWORD = process.env.DATHOST_PASSWORD;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SERVER_IDS = process.env.DATHOST_SERVER_IDS.split(",");
const PORT = 3000;

const authHeader =
  "Basic " +
  Buffer.from(`${DATHOST_EMAIL}:${DATHOST_PASSWORD}`).toString("base64");

// Slash командууд бүртгэх
const commands = [
  new SlashCommandBuilder()
    .setName("match")
    .setDescription("DatHost дээр шинэ match үүсгэх")
    .addStringOption((opt) =>
      opt
        .setName("map")
        .setDescription("Map сонгох (жнь: de_mirage)")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("server")
        .setDescription("Сервер дугаар (1, 2, 3)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("cancel")
    .setDescription("Одоогийн match цуцлах")
    .addStringOption((opt) =>
      opt.setName("match_id").setDescription("Match ID").setRequired(true),
    ),
].map((cmd) => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands,
    });
    console.log("✅ Slash командууд бүртгэгдлээ.");
  } catch (err) {
    console.error("Slash command бүртгэх алдаа:", err.message);
  }
}

// DatHost-д match үүсгэх
async function createMatch(serverId, map = "de_mirage") {
  const body = JSON.stringify({
    game_server_id: serverId,
    team1: { name: "Team 1" },
    team2: { name: "Team 2" },
    settings: {
      map: map,
      team_size: 1,
      connect_time: 300,
      match_begin_countdown: 10,
    },
    webhooks: {
      match_end_url: `${WEBHOOK_URL}/webhook`,
    },
  });

  const res = await fetch("https://dathost.net/api/0.1/cs2-matches", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DatHost API error: ${res.status} — ${text}`);
  }

  return await res.json();
}

// Match цуцлах
async function cancelMatch(matchId) {
  const res = await fetch(
    `https://dathost.net/api/0.1/cs2-matches/${matchId}/cancel`,
    {
      method: "POST",
      headers: { Authorization: authHeader },
    },
  );
  return res.ok;
}

// Player stats embed
function buildStatsEmbed(match) {
  const players = match.players || [];
  const team1 = players.filter((p) => p.team === "team1");
  const team2 = players.filter((p) => p.team === "team2");

  const scoreA = match.team1?.stats?.score ?? 0;
  const scoreB = match.team2?.stats?.score ?? 0;

  const winner =
    scoreA > scoreB
      ? "🏆 Team 1 wins!"
      : scoreB > scoreA
        ? "🏆 Team 2 wins!"
        : "🤝 Draw!";

  const formatPlayers = (list) => {
    if (!list.length) return "*Тоглогч байхгүй*";
    return list
      .sort((a, b) => (b.stats?.kills || 0) - (a.stats?.kills || 0))
      .map((p) => {
        const s = p.stats || {};
        return `**${p.nickname_override || p.steam_id_64}** — K: ${s.kills || 0} / D: ${s.deaths || 0} / A: ${s.assists || 0}`;
      })
      .join("\n");
  };

  const serverId = match.game_server_id || "";
  const serverIndex = SERVER_IDS.indexOf(serverId) + 1;

  return new EmbedBuilder()
    .setTitle(
      `🎮 CS2 Match дууслаа!${serverIndex ? ` (Server ${serverIndex})` : ""}`,
    )
    .setColor(serverIndex <= 1 ? 0x00b4d8 : 0xf77f00)
    .addFields(
      {
        name: `${match.team1?.name || "Team 1"} — ${scoreA} оноо`,
        value: formatPlayers(team1),
        inline: false,
      },
      {
        name: `${match.team2?.name || "Team 2"} — ${scoreB} оноо`,
        value: formatPlayers(team2),
        inline: false,
      },
      { name: "Үр дүн", value: winner, inline: false },
      { name: "Map", value: match.settings?.map || "Unknown", inline: true },
      { name: "Rounds", value: String(match.rounds_played || 0), inline: true },
    )
    .setFooter({ text: `Match ID: ${match.id}` })
    .setTimestamp();
}

// Discord-д stats илгээх
async function sendMatchResult(match) {
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;
    await channel.send({ embeds: [buildStatsEmbed(match)] });
    console.log(`✅ Match ${match.id} Discord-д илгээгдлээ.`);
  } catch (err) {
    console.error("sendMatchResult error:", err.message);
  }
}

// Slash команд handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "match") {
    const map = interaction.options.getString("map") || "de_mirage";
    const serverNum =
      parseInt(interaction.options.getString("server") || "1") - 1;
    const serverId = SERVER_IDS[serverNum] || SERVER_IDS[0];

    await interaction.deferReply();

    try {
      const match = await createMatch(serverId, map);
      const embed = new EmbedBuilder()
        .setTitle("✅ Match үүслээ!")
        .setColor(0x00ff00)
        .addFields(
          { name: "Match ID", value: match.id, inline: false },
          { name: "Map", value: map, inline: true },
          { name: "Server", value: `Server ${serverNum + 1}`, inline: true },
        )
        .setFooter({ text: "Match дуусахад stats автоматаар гарна." })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply(`❌ Алдаа: ${err.message}`);
    }
  }

  if (interaction.commandName === "cancel") {
    const matchId = interaction.options.getString("match_id");
    await interaction.deferReply();
    const ok = await cancelMatch(matchId);
    await interaction.editReply(
      ok ? `✅ Match \`${matchId}\` цуцлагдлаа.` : `❌ Match цуцлах боломжгүй.`,
    );
  }
});

// Webhook HTTP сервер
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        console.log("📩 Webhook ирлээ, finished:", data.finished);
        if (data.finished === true) {
          await sendMatchResult(data);
        }
        res.writeHead(200);
        res.end("OK");
      } catch (err) {
        console.error("Webhook error:", err.message);
        res.writeHead(400);
        res.end("Bad Request");
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

client.once("ready", async () => {
  console.log(`✅ Bot нэвтэрлээ: ${client.user.tag}`);
  await registerCommands();
  server.listen(PORT, () => {
    console.log(`🌐 Webhook сервер port ${PORT} дээр ажиллаж байна.`);
    console.log(`🔗 Webhook URL: ${WEBHOOK_URL}/webhook`);
  });
});

client.login(DISCORD_TOKEN);
