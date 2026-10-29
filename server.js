const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаем все файлы прямо из корневой папки (без папки public)
app.use(express.static(__dirname));

// Хранилище голосов в оперативной памяти (сбрасывается при каждом редеплое/перезапуске сервера)
let state = {
  yes: 0,
  no: 0,
  online: 0,
  recentActivity: []
};

io.on('connection', (socket) => {
  state.online = io.engine.clientsCount;
  
  // Отправляем текущие данные новому пользователю и обновляем счетчик онлайна у всех
  io.emit('stateUpdate', state);

  // Обработка голоса
  socket.on('castVote', (data) => {
    const { choice, prevChoice } = data;
    
    // Если пользователь меняет свой голос
    if (prevChoice === 'yes' && state.yes > 0) state.yes--;
    if (prevChoice === 'no' && state.no > 0) state.no--;

    if (choice === 'yes') {
      state.yes++;
      addLog('Кто-то проголосовал «ЗА» замену 👍', 'yes');
    } else if (choice === 'no') {
      state.no++;
      addLog('Кто-то проголосовал «ПРОТИВ» замены 👎', 'no');
    }

    // Моментально рассылаем обновленные данные всем подключенным устройствам
    io.emit('stateUpdate', state);
  });

  socket.on('disconnect', () => {
    state.online = io.engine.clientsCount;
    io.emit('stateUpdate', state);
  });
});

function addLog(message, type) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.recentActivity.unshift({ message, type, time });
  if (state.recentActivity.length > 6) {
    state.recentActivity.pop();
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер петиции запущен на порту ${PORT}`);
});
