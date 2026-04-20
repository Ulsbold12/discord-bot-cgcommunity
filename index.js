require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const http = require("http");
const https = require("https");
const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

const SENT_MATCHES_FILE = "./sent_matches.json";
const LIVE_MESSAGES_FILE = "./live_messages.json";
const LEADERBOARD_FILE = "./leaderboard.json";

const RENDER_URL = "https://discord-bot-cgcommunity.onrender.com";

// ── STORAGE ─────────────────────────

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  return fallback;
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const sentMatches = new Set(loadJSON(SENT_MATCHES_FILE, []));
const liveMessageIds = loadJSON(LIVE_MESSAGES_FILE, {});
const liveScoreMessages = new Map();

function loadLeaderboard() {
  return loadJSON(LEADERBOARD_FILE, {});
}

function saveLeaderboard(data) {
  saveJSON(LEADERBOARD_FILE, data);
}

// ── DISCORD ─────────────────────────

let cachedChannel = null;

async function getChannel() {
  if (cachedChannel) return cachedChannel;
  if (!client.isReady()) return null;
  cachedChannel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  return cachedChannel;
}

// ── RATING ─────────────────────────

function calcRating(k, d, a, dmg, r) {
  if (!r) return 0;
  return Math.max(0, (k / r + 0.7 * (a / r) + dmg / r / 100 - d / r) / 0.5);
}

// ── EMBEDS ─────────────────────────

function buildLiveEmbed(data) {
  return new EmbedBuilder()
    .setTitle("📊 LIVE SCORE")
    .setColor(0xffa500)
    .addFields(
      { name: data.team1.name, value: String(data.team1.score), inline: true },
      { name: "VS", value: "-", inline: true },
      { name: data.team2.name, value: String(data.team2.score), inline: true },
      { name: "Round", value: String(data.round_number), inline: true },
    )
    .setTimestamp();
}

function buildStatsEmbed(data) {
  const t1 = data.team1;
  const t2 = data.team2;

  const players = [...t1.players, ...t2.players];
  const rounds = t1.score + t2.score;

  const mvp = players.reduce((b, p) => {
    const r = calcRating(
      p.stats.kills,
      p.stats.deaths,
      p.stats.assists,
      p.stats.damage,
      rounds,
    );
    const br = calcRating(
      b?.stats?.kills || 0,
      b?.stats?.deaths || 0,
      b?.stats?.assists || 0,
      b?.stats?.damage || 0,
      rounds,
    );
    return r > br ? p : b;
  }, null);

  const format = (arr) =>
    arr
      .map((p) => {
        const s = p.stats;
        const kd =
          s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);

        const hs = s.kills > 0 ? Math.round((s.headshots / s.kills) * 100) : 0;

        const star = p === mvp ? " 🌟" : "";

        return `**${p.name}${star}** — K:${s.kills} D:${s.deaths} | KD:${kd} | HS:${hs}%`;
      })
      .join("\n");

  return new EmbedBuilder()
    .setTitle("🎮 MATCH RESULT")
    .setColor(0x00b4d8)
    .addFields(
      { name: "Score", value: `${t1.score} - ${t2.score}`, inline: true },
      { name: `🔵 ${t1.name}`, value: format(t1.players) },
      { name: `🔴 ${t2.name}`, value: format(t2.players) },
      { name: "🌟 MVP", value: mvp?.name || "Unknown" },
    )
    .setTimestamp();
}

// ── LEADERBOARD ─────────────────────────

function updateLeaderboard(data) {
  const lb = loadLeaderboard();

  [...data.team1.players, ...data.team2.players].forEach((p) => {
    const id = p.name;
    const s = p.stats;

    if (!lb[id]) {
      lb[id] = {
        name: id,
        kills: 0,
        deaths: 0,
        assists: 0,
        damage: 0,
        rounds: 0,
      };
    }

    lb[id].kills += s.kills;
    lb[id].deaths += s.deaths;
    lb[id].assists += s.assists;
    lb[id].damage += s.damage;
    lb[id].rounds += data.team1.score + data.team2.score;
  });

  saveLeaderboard(lb);
}

// ── ACTIONS ─────────────────────────

async function updateLiveScore(data) {
  const channel = await getChannel();
  if (!channel) return;

  if (liveScoreMessages.has(data.matchid)) {
    try {
      await liveScoreMessages.get(data.matchid).edit({
        embeds: [buildLiveEmbed(data)],
      });
      return;
    } catch {
      liveScoreMessages.delete(data.matchid);
    }
  }

  if (liveMessageIds[data.matchid]) {
    try {
      const msg = await channel.messages.fetch(liveMessageIds[data.matchid]);
      await msg.edit({ embeds: [buildLiveEmbed(data)] });
      liveScoreMessages.set(data.matchid, msg);
      return;
    } catch {
      delete liveMessageIds[data.matchid];
    }
  }

  const msg = await channel.send({ embeds: [buildLiveEmbed(data)] });
  liveScoreMessages.set(data.matchid, msg);
  liveMessageIds[data.matchid] = msg.id;
  saveJSON(LIVE_MESSAGES_FILE, liveMessageIds);
}

async function sendStats(data) {
  const channel = await getChannel();
  if (!channel) return;

  if (liveMessageIds[data.matchid]) {
    try {
      const msg = await channel.messages.fetch(liveMessageIds[data.matchid]);
      await msg.delete();
    } catch {}
    delete liveMessageIds[data.matchid];
  }

  await channel.send({ embeds: [buildStatsEmbed(data)] });

  updateLeaderboard(data);

  sentMatches.add(data.matchid);
  saveJSON(SENT_MATCHES_FILE, [...sentMatches]);
}

// ── SERVER ─────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";

    req.on("data", (c) => (body += c));

    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const event = data.event;

        console.log("📦", event);

        if (event === "round_end") {
          await updateLiveScore(data);
        }

        if (event === "map_result" && !sentMatches.has(data.matchid)) {
          await sendStats(data);
        }

        res.end("OK");
      } catch (e) {
        console.error(e);
        res.end("ERR");
      }
    });
  } else {
    res.end("RUNNING");
  }
});

// ── COMMAND (!top) ─────────────────────────

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === "!top") {
    const lb = loadLeaderboard();
    const players = Object.values(lb);

    players.sort(
      (a, b) =>
        calcRating(b.kills, b.deaths, b.assists, b.damage, b.rounds) -
        calcRating(a.kills, a.deaths, a.assists, a.damage, a.rounds),
    );

    const text = players.slice(0, 10).map((p, i) => {
      const kd =
        p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);

      return `${i + 1}. ${p.name} — KD:${kd}`;
    });

    msg.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 TOP PLAYERS")
          .setDescription(text.join("\n"))
          .setColor(0xffd700),
      ],
    });
  }
});

// ── START ─────────────────────────

server.listen(PORT, () => {
  console.log("🌐 Server started");
});

client.once("ready", () => {
  console.log("✅ Bot ready");

  setInterval(
    () => {
      https.get(RENDER_URL, () => console.log("🏓 ping"));
    },
    14 * 60 * 1000,
  );
});

client.login(process.env.DISCORD_TOKEN);
