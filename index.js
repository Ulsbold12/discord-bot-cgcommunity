require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const http = require("http");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PORT = 3000;

// Илгээсэн match-уудыг хадгалах (давхардахгүйн тулд)
const sentMatches = new Set();

function buildStatsEmbed(data) {
  const team1 = data.team1 || {};
  const team2 = data.team2 || {};

  const t1players = team1.players || [];
  const t2players = team2.players || [];

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
      { name: "🏅 Үр дүн", value: winner, inline: true },
      { name: "🔢 Round", value: String(data.round_number || 0), inline: true },
    )
    .setTimestamp();
}

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
        const matchid = data.matchid || "unknown";
        console.log(`📩 Event: "${event}" | Match: ${matchid}`);

        if (event === "round_end") {
          const score1 = data.team1?.score || 0;
          const score2 = data.team2?.score || 0;
          const maxScore = Math.max(score1, score2);

          console.log(`📊 Score: ${score1} - ${score2}`);

          // Match дуусах нөхцөл: 13 оноо эсвэл overtime (16+)
          const matchKey = `${matchid}`;
          if (maxScore >= 13 && !sentMatches.has(matchKey)) {
            sentMatches.add(matchKey);
            console.log(
              `🎯 Match дууслаа! ${score1}-${score2} Stats илгээж байна...`,
            );
            await sendStats(data);
          }
        }

        if (event === "map_result") {
          console.log("📩 map_result ирлээ — илгээж байна...");
          await sendStats(data);
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
