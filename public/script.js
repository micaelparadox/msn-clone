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
let typing = false; // Flag para evitar envio de várias notificações "digitando"
let typingTimeoutDuration = 3000; // Duração de 3 segundos sem digitar para remover a mensagem de digitação

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
  chatContainer.style.display = 'flex'; // Exibe o chat

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
        }, typingTimeoutDuration);
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

// Função para exibir mensagens, incluindo suporte a links e GIFs
function displayMessage(data) {
  const messageElem = document.createElement('div');
  messageElem.classList.add('message');

  // Detecta URLs e transforma em hyperlinks clicáveis
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let messageText = data.text.replace(urlRegex, function (url) {
    if (url.endsWith('.gif')) {
      return `<img src="${url}" alt="GIF" style="max-width: 200px; max-height: 200px;" />`;
    } else {
      return `<a href="${url}" target="_blank">${url}</a>`;
    }
  });

  if (data.user === username) {
    messageElem.classList.add('user');
    messageElem.style.textAlign = 'right';
  } else {
    messageElem.classList.add('other');
    messageElem.style.textAlign = 'left';
  }

  const time = new Date(data.timestamp).toLocaleString('pt-BR');
  messageElem.innerHTML = `<strong>${data.user}</strong> <small>(${time})</small>: ${messageText}`;
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

    if (user.status === 'online') {
      onlineCount++;
    }

    const avatarUrl = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(user.username)}`;

    // Badge de mensagens não lidas
    const unreadBadge = document.createElement('span');
    unreadBadge.className = 'unread-badge';
    unreadBadge.dataset.username = user.username; // Para identificar pelo nome
    unreadBadge.textContent = '0'; // Começa com 0 mensagens não lidas
    userItem.appendChild(unreadBadge);

    userItem.innerHTML += `<span class="status-icon ${statusClass}"></span><img src="${avatarUrl}" alt="User Icon" width="40" height="40"> ${user.username}`;
    userItem.addEventListener('click', () => {
      openChatWindow(user.username);
      resetUnreadMessages(user.username); // Resetar contador ao abrir chat
    });
    usersList.appendChild(userItem);
  });

  onlineCounter.textContent = onlineCount;
}

function incrementUnreadMessages(username) {
  const unreadBadge = document.querySelector(`.unread-badge[data-username="${username}"]`);
  if (unreadBadge) {
    let unreadCount = parseInt(unreadBadge.textContent);
    unreadBadge.textContent = unreadCount + 1;
    unreadBadge.style.display = 'block'; // Exibe o contador
  }
}

function resetUnreadMessages(username) {
  const unreadBadge = document.querySelector(`.unread-badge[data-username="${username}"]`);
  if (unreadBadge) {
    unreadBadge.textContent = '0';
    unreadBadge.style.display = 'none'; // Oculta o contador
  }
}

function changeUserStatus(status) {
  if (username) {
    ws.send(JSON.stringify({ type: 'change_status', status }));
    console.log(`Status de ${username} alterado para: ${status}`);
  }
}

function openChatWindow(targetUsername) {
  const chatArea = document.getElementById('chat-area');
  chatArea.style.display = 'none'; // Esconde o chat principal

  // Verifica se o chat privado já está aberto
  let privateChatContainer = document.getElementById('private-chat-container');
  if (!privateChatContainer) {
    // Cria a estrutura de chat privado se não existir
    privateChatContainer = document.createElement('div');
    privateChatContainer.id = 'private-chat-container';
    privateChatContainer.classList.add('card'); 

    privateChatContainer.innerHTML = `
      <div class="private-chat-header">
        <strong>Chat com ${targetUsername}</strong>
        <button id="close-private-chat" class="btn btn-icon">X</button>
      </div>
      <div id="private-messages" class="private-messages"></div>
      <div class="chat-input">
        <input type="text" id="private-message-input" placeholder="Digite uma mensagem" autocomplete="off" />
        <button id="private-send-button" class="btn btn-primary">Enviar</button>
      </div>
    `;

    chatContainer.appendChild(privateChatContainer); // Coloca o chat privado no container do chat
    privateChatContainer.style.display = 'block'; // Exibe o chat privado

    // Evento para fechar o chat privado
    document.getElementById('close-private-chat').addEventListener('click', () => {
      privateChatContainer.style.display = 'none'; // Esconde o chat privado
      chatArea.style.display = 'flex'; // Volta para o chat principal
    });

    // Evento para enviar mensagem no chat privado
    document.getElementById('private-send-button').addEventListener('click', () => {
      sendPrivateMessage(targetUsername);
    });
  } else {
    // Atualiza o cabeçalho do chat se já estiver aberto
    document.querySelector('.private-chat-header strong').textContent = `Chat com ${targetUsername}`;
    privateChatContainer.style.display = 'block'; // Garante que o chat privado seja exibido
  }
}


function sendPrivateMessage(targetUsername) {
  const privateMessageInput = document.getElementById('private-message-input');
  if (privateMessageInput.value.trim() !== '') {
    const message = {
      type: 'private_message',
      recipient: targetUsername, // Corrigido para enviar o campo 'recipient' corretamente
      text: privateMessageInput.value.trim(),
    };
    ws.send(JSON.stringify(message)); // Envia via WebSocket
    privateMessageInput.value = ''; // Limpa o campo de entrada
  }
}

function receivePrivateMessage(user, text) {
  const privateMessagesDiv = document.getElementById('private-messages');
  if (privateMessagesDiv) {
    const messageElem = document.createElement('div');
    messageElem.classList.add('message', 'other');
    messageElem.textContent = `${user}: ${text}`;
    privateMessagesDiv.appendChild(messageElem);
    privateMessagesDiv.scrollTop = privateMessagesDiv.scrollHeight; // Rola para o final automaticamente
  } else {
    incrementUnreadMessages(user); // Incrementa o contador de mensagens não lidas se o chat não estiver aberto
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
  if (!typing) {
    typing = true;
    ws.send(JSON.stringify({ type: 'typing', user: username }));
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typing = false;
  }, typingTimeoutDuration);

  if (event.key === 'Enter') {
    sendMessage();
    typing = false;
  }
});

sendButton.addEventListener('click', () => {
  sendMessage();
});
