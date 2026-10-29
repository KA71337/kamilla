const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const appName = "9Ч — Голос класса";
const choices = ["За изменения в классе", "Пока всё оставить как есть"];
const useDb = Boolean(process.env.DATABASE_URL);
let pool;
let memoryVotes = new Map();

if (useDb) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost")
      ? false : { rejectUnauthorized: false }
  });
}

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

function voterId(req) {
  // Anonymous browser identifier; never collect names or email addresses.
  const raw = req.get("x-voter-id") || "";
  if (!/^[a-f0-9-]{20,80}$/i.test(raw)) return null;
  return raw;
}

async function initDb() {
  if (!useDb) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      voter_id VARCHAR(80) PRIMARY KEY,
      choice SMALLINT NOT NULL CHECK (choice IN (0,1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getResults() {
  if (useDb) {
    const result = await pool.query(
      "SELECT choice, COUNT(*)::int AS count FROM poll_votes GROUP BY choice"
    );
    const counts = [0, 0];
    let total = 0;
    for (const row of result.rows) {
      counts[row.choice] = row.count;
      total += row.count;
    }
    return { total, counts };
  }
  const counts = [0, 0];
  for (const vote of memoryVotes.values()) counts[vote] += 1;
  return { total: memoryVotes.size, counts };
}

app.get("/api/results", async (_req, res) => {
  try { res.json(await getResults()); }
  catch (err) {
    console.error("Results error:", err.message);
    res.status(500).json({ error: "Не удалось загрузить результаты" });
  }
});

app.post("/api/vote", async (req, res) => {
  const id = voterId(req);
  const choice = Number(req.body && req.body.choice);
  if (!id) return res.status(400).json({ error: "Обнови страницу и попробуй снова." });
  if (![0, 1].includes(choice)) return res.status(400).json({ error: "Выбери один из вариантов." });

  try {
    if (useDb) {
      const inserted = await pool.query(
        "INSERT INTO poll_votes (voter_id, choice) VALUES ($1, $2) ON CONFLICT (voter_id) DO NOTHING RETURNING voter_id",
        [id, choice]
      );
      if (!inserted.rowCount) {
        return res.status(409).json({ error: "С этого браузера голос уже отправлен." });
      }
    } else {
      if (memoryVotes.has(id)) {
        return res.status(409).json({ error: "С этого браузера голос уже отправлен." });
      }
      memoryVotes.set(id, choice);
    }
    const results = await getResults();
    io.emit("results", results);
    res.json({ ok: true, results });
  } catch (err) {
    console.error("Vote error:", err.message);
    res.status(500).json({ error: "Не получилось сохранить голос. Попробуй позже." });
  }
});

io.on("connection", async (socket) => {
  socket.emit("presence", { online: io.engine.clientsCount });
  socket.broadcast.emit("presence", { online: io.engine.clientsCount });
  try { socket.emit("results", await getResults()); } catch {}
  socket.on("disconnect", () => {
    io.emit("presence", { online: io.engine.clientsCount });
  });
});

initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`${appName} listening on ${PORT}`);
    console.log(useDb ? "Persistence: PostgreSQL" : "Persistence: temporary memory (votes reset on restart)");
  });
}).catch((err) => {
  console.error("Database initialization failed:", err.message);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  if (pool) await pool.end().catch(() => {});
  server.close(() => process.exit(0));
});