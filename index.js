require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const http = require("http");
const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PORT = 3000;
const LEADERBOARD_FILE = "./leaderboard.json";

const sentMatches = new Set();
const liveScoreMessages = new Map(); // matchid -> Discord message
const matchStartTimes = new Map();   // matchid -> Date.now()

// ── Leaderboard ──────────────────────────────────────────────────────────────

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8"));
    }
  } catch (_) {}
  return {};
}

function saveLeaderboard(data) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2));
}

function updateLeaderboard(data) {
  const lb = loadLeaderboard();
  const allPlayers = [
    ...(data.team1?.players || []),
    ...(data.team2?.players || []),
  ];
  const rounds = (data.team1?.score || 0) + (data.team2?.score || 0);

  for (const p of allPlayers) {
    const id = p.steamid || p.name || "unknown";
    const s = p.stats || {};
    if (!lb[id]) {
      lb[id] = { name: p.name || id, matches: 0, kills: 0, deaths: 0, assists: 0, damage: 0, headshots: 0, rounds: 0 };
    }
    const e = lb[id];
    e.name = p.name || id;
    e.matches += 1;
    e.kills += s.kills || 0;
    e.deaths += s.deaths || 0;
    e.assists += s.assists || 0;
    e.damage += s.damage || 0;
    e.headshots += s.headshots || 0;
    e.rounds += rounds;
  }

  saveLeaderboard(lb);
}

// ── Rating ───────────────────────────────────────────────────────────────────

// Хялбаршуулсан HLTV-style rating
function calcRating(kills, deaths, assists, damage, rounds) {
  if (!rounds) return 0;
  const kpr = kills / rounds;
  const apr = assists / rounds;
  const dpr = deaths / rounds;
  const adr = damage / rounds;
  return Math.max(0, (kpr + 0.7 * apr + adr / 100 - dpr) / 0.5);
}

function playerRating(stats, rounds) {
  return calcRating(
    stats.kills || 0,
    stats.deaths || 0,
    stats.assists || 0,
    stats.damage || 0,
    rounds
  );
}

// ── Embed builders ────────────────────────────────────────────────────────────

function buildStatsEmbed(data) {
  const team1 = data.team1 || {};
  const team2 = data.team2 || {};
  const t1players = team1.players || [];
  const t2players = team2.players || [];
  const allPlayers = [...t1players, ...t2players];

  const score1 = team1.score ?? 0;
  const score2 = team2.score ?? 0;
  const rounds = score1 + score2;

  const winner =
    score1 > score2
      ? `🏆 ${team1.name || "Team 1"} wins!`
      : score2 > score1
        ? `🏆 ${team2.name || "Team 2"} wins!`
        : "🤝 Draw!";

  // MVP — хамгийн өндөр rating-тэй тоглогч
  const mvp = allPlayers.reduce((best, p) => {
    const r = playerRating(p.stats || {}, rounds);
    const br = playerRating(best?.stats || {}, rounds);
    return r > br ? p : best;
  }, null);
  const mvpName = mvp ? (mvp.name || mvp.steamid || "Unknown") : null;

  // Match duration
  const startTime = matchStartTimes.get(data.matchid);
  const duration = startTime ? Math.round((Date.now() - startTime) / 60000) : null;

  const formatPlayers = (players) => {
    if (!players.length) return "*Тоглогч байхгүй*";
    return players
      .sort((a, b) => playerRating(b.stats || {}, rounds) - playerRating(a.stats || {}, rounds))
      .map((p) => {
        const s = p.stats || {};
        const name = p.name || p.steamid || "Unknown";
        const k = s.kills || 0;
        const d = s.deaths || 0;
        const a = s.assists || 0;
        const dmg = s.damage || 0;
        const hs = s.headshots || 0;
        const hsPercent = k > 0 ? Math.round((hs / k) * 100) : 0;
        const kd = d > 0 ? (k / d).toFixed(2) : k.toFixed(2);
        const rating = playerRating(s, rounds).toFixed(2);
        const star = name === mvpName ? " 🌟" : "";
        return `**${name}${star}** — K:${k}/D:${d}/A:${a} | KD:${kd} | DMG:${dmg} | HS:${hsPercent}% | ⭐${rating}`;
      })
      .join("\n");
  };

  const embed = new EmbedBuilder()
    .setTitle("🎮 CS2 Match дууслаа!")
    .setColor(0x00b4d8)
    .addFields(
      { name: "🗺️ Map", value: data.map || "Unknown", inline: true },
      { name: "🔢 Нийт round", value: String(rounds), inline: true },
    );

  if (duration !== null) {
    embed.addFields({ name: "⏱️ Үргэлжилсэн", value: `${duration} мин`, inline: true });
  }

  embed.addFields(
    {
      name: `🔵 ${team1.name || "Team 1"} — ${score1} оноо`,
      value: formatPlayers(t1players),
      inline: false,
    },
    {
      name: `🔴 ${team2.name || "Team 2"} — ${score2} оноо`,
      value: formatPlayers(t2players),
      inline: false,
    },
    { name: "🏅 Үр дүн", value: winner, inline: true },
  );

  if (mvpName) {
    embed.addFields({ name: "🌟 MVP", value: mvpName, inline: true });
  }

  embed.setTimestamp();
  return embed;
}

function buildLiveEmbed(data) {
  const team1 = data.team1 || {};
  const team2 = data.team2 || {};
  const score1 = team1.score ?? 0;
  const score2 = team2.score ?? 0;

  return new EmbedBuilder()
    .setTitle("📊 Live Score")
    .setColor(0xffa500)
    .addFields(
      { name: team1.name || "Team 1", value: String(score1), inline: true },
      { name: "VS", value: "—", inline: true },
      { name: team2.name || "Team 2", value: String(score2), inline: true },
      { name: "🔢 Round", value: String(data.round_number || 0), inline: true },
      { name: "🗺️ Map", value: data.map || "Unknown", inline: true },
    )
    .setTimestamp();
}

function buildLeaderboardEmbed(lb) {
  const players = Object.values(lb);
  if (!players.length) {
    return new EmbedBuilder()
      .setTitle("🏆 Leaderboard")
      .setDescription("Одоогоор мэдээлэл байхгүй.")
      .setColor(0xffd700);
  }

  players.sort(
    (a, b) =>
      calcRating(b.kills, b.deaths, b.assists, b.damage, b.rounds) -
      calcRating(a.kills, a.deaths, a.assists, a.damage, a.rounds)
  );

  const rows = players.slice(0, 10).map((p, i) => {
    const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
    const hsPercent = p.kills > 0 ? Math.round((p.headshots / p.kills) * 100) : 0;
    const rating = calcRating(p.kills, p.deaths, p.assists, p.damage, p.rounds).toFixed(2);
    return `**${i + 1}. ${p.name}** — ${p.matches} match | KD:${kd} | HS:${hsPercent}% | ⭐${rating}`;
  });

  return new EmbedBuilder()
    .setTitle("🏆 Leaderboard — Top 10")
    .setColor(0xffd700)
    .setDescription(rows.join("\n"))
    .setTimestamp();
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function sendStats(data) {
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;

    // Live score message-ийг устгах
    const liveMsg = liveScoreMessages.get(data.matchid);
    if (liveMsg) {
      try { await liveMsg.delete(); } catch (_) {}
      liveScoreMessages.delete(data.matchid);
    }

    await channel.send({ embeds: [buildStatsEmbed(data)] });
    updateLeaderboard(data);
    matchStartTimes.delete(data.matchid);
    console.log("✅ Stats Discord-д илгээгдлээ!");
  } catch (err) {
    console.error("sendStats error:", err.message);
  }
}

async function updateLiveScore(data) {
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;

    const existing = liveScoreMessages.get(data.matchid);
    if (existing) {
      await existing.edit({ embeds: [buildLiveEmbed(data)] });
    } else {
      const msg = await channel.send({ embeds: [buildLiveEmbed(data)] });
      liveScoreMessages.set(data.matchid, msg);
    }
  } catch (err) {
    console.error("updateLiveScore error:", err.message);
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const event = data.event || "unknown";
        const matchid = data.matchid || "unknown";
        console.log(`📩 Event: "${event}" | Match: ${matchid}`);

        if (event === "round_end") {
          if (!matchStartTimes.has(matchid)) {
            matchStartTimes.set(matchid, Date.now());
          }

          const score1 = data.team1?.score || 0;
          const score2 = data.team2?.score || 0;
          const maxScore = Math.max(score1, score2);
          console.log(`📊 Score: ${score1} - ${score2}`);

          await updateLiveScore(data);

          // Match дуусах нөхцөл: 13 эсвэл OT (16, 19, 22...) — (score - 13) % 3 === 0
          const isMatchOver =
            maxScore >= 13 &&
            (maxScore - 13) % 3 === 0 &&
            score1 !== score2;

          if (isMatchOver && !sentMatches.has(matchid)) {
            sentMatches.add(matchid);
            console.log(`🎯 Match дууслаа! ${score1}-${score2} Stats илгээж байна...`);
            await sendStats(data);
          }
        }

        if (event === "map_result") {
          console.log("📩 map_result ирлээ — илгээж байна...");
          if (!sentMatches.has(data.matchid)) {
            sentMatches.add(data.matchid);
            await sendStats(data);
          }
        }

        res.writeHead(200);
        res.end("OK");
      } catch (err) {
        console.error("Webhook error:", err.message);
        res.writeHead(400);
        res.end("Bad Request");
      }
    });
  } else if (req.method === "GET" && req.url === "/leaderboard") {
    client.channels.fetch(DISCORD_CHANNEL_ID).then(async (channel) => {
      const lb = loadLeaderboard();
      await channel.send({ embeds: [buildLeaderboardEmbed(lb)] });
    }).catch(() => {});
    res.writeHead(200);
    res.end("Leaderboard илгээгдлээ!");
  } else {
    res.writeHead(200);
    res.end("Bot is running!");
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

client.once("clientReady", async () => {
  console.log(`✅ Bot нэвтэрлээ: ${client.user.tag}`);
  server.listen(PORT, () => {
    console.log(`🌐 Webhook сервер port ${PORT} дээр ажиллаж байна.`);
    console.log(`🔗 Webhook URL: https://overgrievous-katerine-nonadhesively.ngrok-free.dev/webhook`);
  });
});

client.login(process.env.DISCORD_TOKEN);
