require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const http = require("http");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const SERVER_IDS = process.env.DATHOST_SERVER_IDS.split(",");
const PORT = 3000;

// MatchZy webhook-оос ирсэн stats-г Discord embed болгох
function buildStatsEmbed(data) {
  const players = data.players || data.result?.players || [];
  const team1players = players.filter(
    (p) => p.team === "team1" || p.side === "ct" || p.team === "CT",
  );
  const team2players = players.filter(
    (p) => p.team === "team2" || p.side === "t" || p.team === "T",
  );

  const score1 = data.team1?.score ?? data.result?.team1_score ?? 0;
  const score2 = data.team2?.score ?? data.result?.team2_score ?? 0;

  const winner =
    score1 > score2
      ? "🏆 Team 1 wins!"
      : score2 > score1
        ? "🏆 Team 2 wins!"
        : "🤝 Draw!";

  const formatPlayers = (list) => {
    if (!list.length) return "*Тоглогч байхгүй*";
    return list
      .sort(
        (a, b) =>
          (b.kills || b.stats?.kills || 0) - (a.kills || a.stats?.kills || 0),
      )
      .map((p) => {
        const name = p.name || p.nickname || p.steam_id || "Unknown";
        const kills = p.kills ?? p.stats?.kills ?? 0;
        const deaths = p.deaths ?? p.stats?.deaths ?? 0;
        const assists = p.assists ?? p.stats?.assists ?? 0;
        return `**${name}** — K: ${kills} / D: ${deaths} / A: ${assists}`;
      })
      .join("\n");
  };

  const map = data.map || data.result?.map || data.mapname || "Unknown";
  const serverId = data.server_id || data.game_server_id || "";
  const serverIndex = SERVER_IDS.indexOf(serverId) + 1;

  return new EmbedBuilder()
    .setTitle(
      `🎮 CS2 Match дууслаа!${serverIndex > 0 ? ` (Server ${serverIndex})` : ""}`,
    )
    .setColor(0x00b4d8)
    .addFields(
      {
        name: `🔵 Team 1 — ${score1} оноо`,
        value: formatPlayers(team1players) || "*Тоглогч байхгүй*",
        inline: false,
      },
      {
        name: `🔴 Team 2 — ${score2} оноо`,
        value: formatPlayers(team2players) || "*Тоглогч байхгүй*",
        inline: false,
      },
      { name: "🗺️ Map", value: map, inline: true },
      { name: "🏅 Үр дүн", value: winner, inline: true },
    )
    .setTimestamp();
}

// Discord-д stats илгээх
async function sendStats(data) {
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;
    await channel.send({ embeds: [buildStatsEmbed(data)] });
    console.log("✅ Stats Discord-д илгээгдлээ!");
  } catch (err) {
    console.error("sendStats error:", err.message);
  }
}

// Webhook HTTP сервер
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        console.log("📩 Webhook ирлээ");
        const data = JSON.parse(body);

        // MatchZy match дуусах event
        if (
          data.event === "series_end" ||
          data.event === "map_result" ||
          data.finished === true
        ) {
          console.log("🎯 Match дууслаа! Stats илгээж байна...");
          await sendStats(data);
        }

        res.writeHead(200);
        res.end("OK");
      } catch (err) {
        console.error("Webhook error:", err.message);
        console.log("Raw body:", body.substring(0, 500));
        res.writeHead(400);
        res.end("Bad Request");
      }
    });
  } else {
    res.writeHead(200);
    res.end("Bot is running!");
  }
});

client.once("ready", async () => {
  console.log(`✅ Bot нэвтэрлээ: ${client.user.tag}`);

  server.listen(PORT, () => {
    console.log(`🌐 Webhook сервер port ${PORT} дээр ажиллаж байна.`);
    console.log(
      `🔗 Webhook URL: https://overgrievous-katerine-nonadhesively.ngrok-free.dev/webhook`,
    );
    console.log(`📋 MatchZy config.cfg дээр энэ URL тохируулсан байх ёстой!`);
  });
});

client.login(process.env.DISCORD_TOKEN);
