const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["polling", "websocket"]
});

const PORT = process.env.PORT || 3000;

// Опции голосования (нейтральные формулировки)
const CHOICES = [
  "За предложенные нововведения в классе",
  "Сохранить текущий формат без изменений"
];

// Хранилище в оперативной памяти сервера (сбрасывается при перезапуске)
// Ключ: анонимный voterId (UUID/хэш браузера), Значение: индекс выбора (0 или 1)
const votesStore = new Map();

app.use(express.json({ limit: "20kb" }));

// Раздача статики из папки public
app.use(express.static(path.join(__dirname, "public")));

// Поддержка корневого файла index.html как резерв
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Проверка и нормализация анонимного идентификатора браузера
function getVoterId(req) {
  const headerId = req.get("x-voter-id") || (req.body && req.body.voterId) || "";
  const cleaned = String(headerId).trim();
  if (/^[a-zA-Z0-9_-]{16,128}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

// Расчёт сводки результатов
function getPollResults() {
  const counts = [0, 0];
  for (const choice of votesStore.values()) {
    if (choice === 0 || choice === 1) {
      counts[choice] += 1;
    }
  }
  const total = votesStore.size;
  const percentages = counts.map((count) =>
    total > 0 ? Math.round((count / total) * 100) : 0
  );

  return {
    choices: CHOICES,
    counts,
    percentages,
    total
  };
}

// API: Получение текущих результатов
app.get("/api/results", (_req, res) => {
  try {
    res.json({
      success: true,
      results: getPollResults()
    });
  } catch (err) {
    console.error("Ошибка при получении результатов:", err);
    res.status(500).json({ success: false, error: "Не удалось получить результаты" });
  }
});

// API: Проверка статуса голоса конкретного клиента
app.get("/api/check-status", (req, res) => {
  const voterId = getVoterId(req);
  if (!voterId) {
    return res.status(400).json({ success: false, error: "Некорректный идентификатор" });
  }
  const hasVoted = votesStore.has(voterId);
  const choice = hasVoted ? votesStore.get(voterId) : null;
  res.json({
    success: true,
    hasVoted,
    choice,
    results: getPollResults()
  });
});

// API: Отправка голоса
app.post("/api/vote", (req, res) => {
  const voterId = getVoterId(req);
  const choice = Number(req.body && req.body.choice);

  if (!voterId) {
    return res.status(400).json({
      success: false,
      error: "Не удалось идентифицировать сессию. Обновите страницу."
    });
  }

  if (![0, 1].includes(choice)) {
    return res.status(400).json({
      success: false,
      error: "Неверный вариант ответа. Выберите один из пунктов."
    });
  }

  // Защита от повторного голосования
  if (votesStore.has(voterId)) {
    return res.status(409).json({
      success: false,
      alreadyVoted: true,
      choice: votesStore.get(voterId),
      error: "С этого браузера голос уже был зарегистрирован.",
      results: getPollResults()
    });
  }

  // Фиксация голоса в памяти сервера
  votesStore.set(voterId, choice);
  const updatedResults = getPollResults();

  // Мгновенная рассылка обновлений всем подключённым клиентам через WebSocket
  io.emit("results_update", updatedResults);

  return res.json({
    success: true,
    choice,
    results: updatedResults
  });
});

// Управление сокет-соединениями
io.on("connection", (socket) => {
  // Отправляем текущее количество участников в реальном времени
  const updateOnline = () => {
    io.emit("online_count", { online: io.engine.clientsCount });
  };

  updateOnline();

  // Отправляем свежие результаты новому подключению
  socket.emit("results_update", getPollResults());

  socket.on("disconnect", () => {
    updateOnline();
  });

  socket.on("error", (err) => {
    console.warn("Socket error:", err?.message || err);
  });
});

// Graceful shutdown
function shutdown() {
  console.log("Остановка сервера...");
  server.close(() => {
    console.log("Сервер остановлен.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Запуск прослушивания порта (0.0.0.0 для облачных сред Render/Koyeb/Railway)
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[9Ч Голосование] Сервер успешно запущен на порту ${PORT}`);
  console.log(`[9Ч Голосование] Хранилище: in-memory (сброс при перезапуске сервера)`);
});
