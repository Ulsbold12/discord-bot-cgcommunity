require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const http = require("http");
const https = require("https");
const fs = require("fs");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

const SENT_MATCHES_FILE = "./sent_matches.json";
const LIVE_MESSAGES_FILE = "./live_messages.json";

const RENDER_URL = "https://discord-bot-cgcommunity.onrender.com";

// ── Storage ─────────────────────────

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    console.error("JSON load error:", e.message);
  }
  return fallback;
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const sentMatches = new Set(loadJSON(SENT_MATCHES_FILE, []));
const liveMessageIds = loadJSON(LIVE_MESSAGES_FILE, {});

const liveScoreMessages = new Map();
const matchStartTimes = new Map();

let cachedChannel = null;

async function getChannel() {
  if (cachedChannel) return cachedChannel;
  cachedChannel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  return cachedChannel;
}

// ── Helpers ─────────────────────────

// ⚠️ matchid байхгүй үед fallback key
function getMatchKey(data) {
  return data.matchid || `${data.map}_${data.round_number || 0}`;
}

// ── Embed ─────────────────────────

function buildLiveEmbed(data) {
  const t1 = data.team1 || {};
  const t2 = data.team2 || {};

  return new EmbedBuilder()
    .setTitle("📊 Live Score")
    .setColor(0xffa500)
    .addFields(
      { name: t1.name || "Team 1", value: String(t1.score ?? 0), inline: true },
      { name: "VS", value: "-", inline: true },
      { name: t2.name || "Team 2", value: String(t2.score ?? 0), inline: true },
      { name: "Round", value: String(data.round_number || 0), inline: true },
      { name: "Map", value: data.map || "Unknown", inline: true },
    )
    .setTimestamp();
}

function buildStatsEmbed(data) {
  const t1 = data.team1 || {};
  const t2 = data.team2 || {};

  return new EmbedBuilder()
    .setTitle("🎮 MATCH FINISHED")
    .setColor(0x00b4d8)
    .addFields(
      { name: "Map", value: data.map || "Unknown", inline: true },
      {
        name: "Score",
        value: `${t1.score ?? 0} - ${t2.score ?? 0}`,
        inline: true,
      },
    )
    .setTimestamp();
}

// ── LIVE UPDATE ─────────────────────────

async function updateLiveScore(data) {
  const key = getMatchKey(data);

  try {
    const channel = await getChannel();

    console.log("🔄 Updating live score:", key);

    // 1. Memory cache
    if (liveScoreMessages.has(key)) {
      try {
        const msg = liveScoreMessages.get(key);
        await msg.edit({ embeds: [buildLiveEmbed(data)] });
        console.log("✏️ Edited (memory)");
        return;
      } catch (err) {
        console.error("❌ Memory edit fail:", err.message);
        liveScoreMessages.delete(key);
      }
    }

    // 2. File cache
    if (liveMessageIds[key]) {
      try {
        const msg = await channel.messages.fetch(liveMessageIds[key]);
        await msg.edit({ embeds: [buildLiveEmbed(data)] });
        liveScoreMessages.set(key, msg);
        console.log("✏️ Edited (fetch)");
        return;
      } catch (err) {
        console.error("❌ Fetch edit fail:", err.message);
        delete liveMessageIds[key];
        saveJSON(LIVE_MESSAGES_FILE, liveMessageIds);
      }
    }

    // 3. Create new
    const msg = await channel.send({ embeds: [buildLiveEmbed(data)] });
    liveScoreMessages.set(key, msg);
    liveMessageIds[key] = msg.id;
    saveJSON(LIVE_MESSAGES_FILE, liveMessageIds);

    console.log("🆕 New live message created");
  } catch (err) {
    console.error("❌ updateLiveScore error:", err.message);
  }
}

// ── FINAL STATS ─────────────────────────

async function sendStats(data) {
  const key = getMatchKey(data);

  try {
    const channel = await getChannel();

    console.log("🏁 Sending stats:", key);

    // live message устгах
    if (liveMessageIds[key]) {
      try {
        const msg = await channel.messages.fetch(liveMessageIds[key]);
        await msg.delete();
        console.log("🗑️ Deleted live message");
      } catch (err) {
        console.error("❌ Delete fail:", err.message);
      }
      delete liveMessageIds[key];
      saveJSON(LIVE_MESSAGES_FILE, liveMessageIds);
    }

    await channel.send({ embeds: [buildStatsEmbed(data)] });

    sentMatches.add(key);
    saveJSON(SENT_MATCHES_FILE, [...sentMatches]);

    console.log("✅ Stats sent");
  } catch (err) {
    console.error("❌ sendStats error:", err.message);
  }
}

// ── SERVER ─────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";

    req.on("data", (chunk) => (body += chunk));

    req.on("end", async () => {
      try {
        const data = JSON.parse(body);

        console.log("📦 FULL DATA:", data);

        const event = data.event || "unknown";
        const key = getMatchKey(data);

        console.log("📩 EVENT:", event, "| KEY:", key);

        // 🔄 LIVE
        if (event === "round_end") {
          await updateLiveScore(data);
        }

        // 🏁 FINAL (FIXED)
        if (event === "map_end" || event === "match_end") {
          if (!sentMatches.has(key)) {
            await sendStats(data);
          }
        }

        res.writeHead(200);
        res.end("OK");
      } catch (err) {
        console.error("❌ Webhook error:", err.message);
        res.writeHead(400);
        res.end("Bad Request");
      }
    });
  } else {
    res.writeHead(200);
    res.end("Bot running");
  }
});

// ── START ─────────────────────────

server.listen(PORT, () => {
  console.log(`🌐 Server running on ${PORT}`);
});

client.once("ready", () => {
  console.log("✅ Bot ready:", client.user.tag);

  setInterval(
    () => {
      https.get(RENDER_URL, () => {
        console.log("🏓 Ping");
      });
    },
    14 * 60 * 1000,
  );
});

client.login(process.env.DISCORD_TOKEN);
