require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const http = require("http");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PORT = 3000;

// Сүүлийн round_end data-г хадгалах (matchid-ээр)
const lastRoundData = {};

// MatchZy webhook stats-г Discord embed болгох
function buildStatsEmbed(mapResult, roundData) {
  const team1 = mapResult.team1 || {};
  const team2 = mapResult.team2 || {};

  // Тоглогчдыг round_end data-аас авах
  const t1players = roundData?.team1?.players || [];
  const t2players = roundData?.team2?.players || [];

  const score1 = team1.score ?? 0;
  const score2 = team2.score ?? 0;

  const winner =
    score1 > score2
      ? `🏆 ${team1.name || "Team 1"} wins!`
      : score2 > score1
        ? `🏆 ${team2.name || "Team 2"} wins!`
        : "🤝 Draw!";

  const formatPlayers = (players) => {
    if (!players || !players.length) return "*Тоглогч байхгүй*";
    return players
      .sort((a, b) => (b.stats?.kills || 0) - (a.stats?.kills || 0))
      .map((p) => {
        const s = p.stats || {};
        const name = p.name || p.steamid || "Unknown";
        const kills = s.kills || 0;
        const deaths = s.deaths || 0;
        const assists = s.assists || 0;
        const damage = s.damage || 0;
        const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
        return `**${name}** — K: ${kills} / D: ${deaths} / A: ${assists} | KD: ${kd} | DMG: ${damage}`;
      })
      .join("\n");
  };

  const map = roundData?.map_name || mapResult.map || "Unknown";

  return new EmbedBuilder()
    .setTitle(`🎮 CS2 Match дууслаа!`)
    .setColor(0x00b4d8)
    .addFields(
      {
        name: `🔵 ${team1.name || "Team 1"} — ${score1} оноо`,
        value: formatPlayers(t1players) || "*Тоглогч байхгүй*",
        inline: false,
      },
      {
        name: `🔴 ${team2.name || "Team 2"} — ${score2} оноо`,
        value: formatPlayers(t2players) || "*Тоглогч байхгүй*",
        inline: false,
      },
      { name: "🗺️ Map", value: map, inline: true },
      { name: "🏅 Үр дүн", value: winner, inline: true },
    )
    .setTimestamp();
}

// Discord-д stats илгээх
async function sendStats(mapResult, roundData) {
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;
    await channel.send({ embeds: [buildStatsEmbed(mapResult, roundData)] });
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
        const data = JSON.parse(body);
        const event = data.event || "unknown";
        const matchid = data.matchid || "default";
        console.log(`📩 Event: "${event}" | Match: ${matchid}`);

        // round_end-ийг хадгалах
        if (event === "round_end") {
          lastRoundData[matchid] = data;
          console.log(`💾 Round data хадгалагдлаа (match: ${matchid})`);
        }

        // map_result ирэхэд сүүлийн round_end-тэй нэгтгэж илгээх
        if (event === "map_result") {
          const roundData = lastRoundData[matchid];
          console.log(
            `🎯 Match дууслаа! Round data: ${roundData ? "байна" : "байхгүй"}`,
          );
          await sendStats(data, roundData);
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
  });
});

client.login(process.env.DISCORD_TOKEN);
