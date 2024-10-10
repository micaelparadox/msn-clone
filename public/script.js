const loginContainer = document.getElementById('login-container');
const chatContainer = document.getElementById('chat-container');
const loginBtn = document.getElementById('login-btn');
const nicknameInput = document.getElementById('nickname-input');
const statusDropdown = document.getElementById('status-dropdown');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const typingDiv = document.getElementById('typing');
const usersList = document.getElementById('users');
const sendButton = document.getElementById('send-button');
const onlineCounter = document.getElementById('online-counter'); // Contador de contatos online
let typingTimeout;
const chatWindows = {};

let username;
let reconnectTimeout;

loginBtn.addEventListener('click', () => {
  username = nicknameInput.value.trim();
  if (!username) {
    alert('Por favor, insira seu nome!');
    return;
  }
  username = username.toLowerCase();
  
  // Esconder a tela de login e mostrar o chat
  loginContainer.style.display = 'none';
  chatContainer.classList.add('active');
  
  connectWebSocket();
});

function reconnectWebSocket() {
  clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    console.log('Tentando reconectar WebSocket...');
    connectWebSocket();
  }, 5000);
}

let ws;
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => {
    console.log('Conectado ao servidor WebSocket');
    ws.send(JSON.stringify({ type: 'join', username }));
    clearTimeout(reconnectTimeout);
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'message') {
      displayMessage(message.data);
    } else if (message.type === 'users') {
      updateUsersList(message.data);
    } else if (message.type === 'private_message') {
      receivePrivateMessage(message.data.user, message.data.text);
    } else if (message.type === 'typing') {
      if (message.data.user !== username) {
        typingDiv.textContent = `${message.data.user} está digitando...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          typingDiv.textContent = '';
        }, 3000);
      }
    }
  };

  ws.onclose = () => {
    console.log('Desconectado do servidor WebSocket');
    reconnectWebSocket();
  };

  ws.onerror = (error) => {
    console.error('Erro no WebSocket:', error);
    ws.close();
  };
}

function displayMessage(data) {
  const messageElem = document.createElement('div');
  messageElem.classList.add('message');
  if (data.user === username) {
    messageElem.classList.add('user');
    messageElem.style.textAlign = 'right';
  } else {
    messageElem.classList.add('other');
    messageElem.style.textAlign = 'left';
  }

  const time = new Date(data.timestamp).toLocaleString('pt-BR');
  messageElem.innerHTML = `<strong>${data.user}</strong> <small>(${time})</small>: ${data.text}`;
  messagesDiv.appendChild(messageElem);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateUsersList(users) {
  usersList.innerHTML = '';
  let onlineCount = 0; // Contador de usuários online
  users.forEach((user) => {
    const userItem = document.createElement('li');
    userItem.className = 'user-item';
    userItem.dataset.username = user.username;
    const statusClass = user.status === 'online' ? 'status-online' : user.status === 'away' ? 'status-away' : 'status-busy';

    // Incrementa o contador apenas para status "online"
    if (user.status === 'online') {
      onlineCount++;
    }

    userItem.innerHTML = `<span class="status-icon ${statusClass}"></span><img src="https://api.dicebear.com/9.x/bottts/svg?seed=${user.username}" alt="User Icon" width="40" height="40"> ${user.username}`;
    userItem.addEventListener('click', () => {
      openChatWindow(user.username);
    });
    usersList.appendChild(userItem);
  });

  // Atualiza o contador de usuários online
  onlineCounter.textContent = onlineCount;
}

function changeUserStatus(status) {
  if (username) {
    ws.send(JSON.stringify({ type: 'change_status', status }));
    console.log(`Status de ${username} alterado para: ${status}`);
  }
}

statusDropdown.addEventListener('change', (event) => {
  changeUserStatus(event.target.value);
});

function sendMessage() {
  if (messageInput.value.trim() !== '') {
    const message = {
      type: 'message',
      text: messageInput.value.trim(),
    };
    ws.send(JSON.stringify(message));
    messageInput.value = '';
  }
}

messageInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

sendButton.addEventListener('click', () => {
  sendMessage();
});
