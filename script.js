const socket = io();

const yesCountEl = document.getElementById('yesCount');
const noCountEl = document.getElementById('noCount');
const yesPercentEl = document.getElementById('yesPercent');
const noPercentEl = document.getElementById('noPercent');
const totalVotesEl = document.getElementById('totalVotes');
const barYesEl = document.getElementById('barYes');
const barNoEl = document.getElementById('barNo');
const btnYesEl = document.getElementById('btnYes');
const btnNoEl = document.getElementById('btnNo');
const btnYesBadge = document.getElementById('btnYesBadge');
const btnNoBadge = document.getElementById('btnNoBadge');
const onlineCountEl = document.getElementById('onlineCount');
const userVoteStatusEl = document.getElementById('userVoteStatus');
const activityListEl = document.getElementById('activityList');

// Храним выбор текущего браузера только на время текущей сессии сервера
let myChoice = null;

function sendVote(choice) {
  if (myChoice === choice) {
    userVoteStatusEl.textContent = 'Вы уже выбрали этот вариант! (Но можете передумать, нажав другую кнопку)';
    return;
  }

  socket.emit('castVote', {
    choice: choice,
    prevChoice: myChoice
  });

  myChoice = choice;
  updateActiveButtons();
}

function updateActiveButtons() {
  btnYesEl.classList.remove('active-yes');
  btnNoEl.classList.remove('active-no');

  if (myChoice === 'yes') {
    btnYesEl.classList.add('active-yes');
    userVoteStatusEl.textContent = '✅ Ваш голос «ЗА замену» учтен в реальном времени!';
  } else if (myChoice === 'no') {
    btnNoEl.classList.add('active-no');
    userVoteStatusEl.textContent = '❌ Ваш голос «ПРОТИВ замены» учтен в реальном времени!';
  }
}

socket.on('stateUpdate', (state) => {
  const yes = state.yes || 0;
  const no = state.no || 0;
  const total = yes + no;

  // Если сервер перезапустился (редеплой) и голоса обнулились — сбрасываем локальную отметку
  if (total === 0 && myChoice !== null) {
    myChoice = null;
    btnYesEl.classList.remove('active-yes');
    btnNoEl.classList.remove('active-no');
    userVoteStatusEl.textContent = 'Нажмите на кнопку выше, чтобы отдать свой голос';
  }

  const yesPercent = total === 0 ? 50 : Math.round((yes / total) * 100);
  const noPercent = total === 0 ? 50 : 100 - yesPercent;

  yesCountEl.textContent = yes;
  noCountEl.textContent = no;
  btnYesBadge.textContent = yes;
  btnNoBadge.textContent = no;
  totalVotesEl.textContent = total;

  yesPercentEl.textContent = `${yesPercent}%`;
  noPercentEl.textContent = `${noPercent}%`;

  barYesEl.style.width = `${yesPercent}%`;
  barNoEl.style.width = `${noPercent}%`;

  onlineCountEl.textContent = state.online || 1;

  // Обновление живой ленты
  if (state.recentActivity && state.recentActivity.length > 0) {
    activityListEl.innerHTML = '';
    state.recentActivity.forEach((item) => {
      const li = document.createElement('li');
      li.className = `activity-item type-${item.type}`;
      li.innerHTML = `
        <span>${item.message}</span>
        <span class="activity-time">${item.time}</span>
      `;
      activityListEl.appendChild(li);
    });
  } else {
    activityListEl.innerHTML = '<li class="activity-empty">Пока никто не проголосовал. Будьте первым!</li>';
  }
});
