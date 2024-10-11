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

// Mapping of currently open private chats
const privateChats = {};

loginBtn.addEventListener('click', () => {
  username = nicknameInput.value.trim();
  if (!username) {
    alert('Por favor, insira seu nome!');
    return;
  }

  // Validate username: alphanumeric and 3-20 characters
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    alert('Nome de usuário inválido! Deve ter 3-20 caracteres alfanuméricos.');
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
      receivePrivateMessage(message.data.user, message.data.text, message.data.recipient);
    } else if (message.type === 'typing') {
      if (message.data.user !== username) {
        displayTypingIndicator(message.data.user, message.data.recipient);
      }
    } else if (message.type === 'error') {
      alert(`Erro: ${message.message}`);
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
      openPrivateChat(user.username);
      resetUnreadMessages(user.username); // Resetar contador ao abrir chat
    });
    usersList.appendChild(userItem);
  });

  onlineCounter.textContent = onlineCount;
}

function displayTypingIndicator(user, recipient) {
  if (recipient && privateChats[recipient]) {
    // Typing in a private chat
    const privateChat = privateChats[recipient];
    const typingIndicator = privateChat.container.querySelector('.typing-indicator');
    if (typingIndicator) {
      typingIndicator.textContent = `${user} está digitando...`;
      clearTimeout(privateChat.typingTimeout);
    } else {
      const newTypingIndicator = document.createElement('div');
      newTypingIndicator.classList.add('typing-indicator');
      newTypingIndicator.textContent = `${user} está digitando...`;
      privateChat.container.insertBefore(newTypingIndicator, privateChat.container.querySelector('.chat-input'));
    }

    // Remove typing indicator after timeout
    privateChats[recipient].typingTimeout = setTimeout(() => {
      const typingIndicator = privateChat.container.querySelector('.typing-indicator');
      if (typingIndicator) typingIndicator.remove();
    }, typingTimeoutDuration);
  } else {
    // Typing in public chat
    typingDiv.textContent = `${user} está digitando...`;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      typingDiv.textContent = '';
    }, typingTimeoutDuration);
  }
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

function openPrivateChat(targetUsername) {
  if (privateChats[targetUsername]) {
    // If chat already exists, focus on it
    privateChats[targetUsername].container.style.display = 'flex';
  } else {
    // Create a new private chat
    const privateChatContainer = document.createElement('div');
    privateChatContainer.classList.add('card', 'private-chat-container');
    privateChatContainer.style.display = 'flex';
    privateChatContainer.style.flexDirection = 'column';

    privateChatContainer.innerHTML = `
      <div class="private-chat-header">
        <strong>Chat com ${targetUsername}</strong>
        <button class="btn btn-icon close-private-chat"><i class="fas fa-times"></i></button>
      </div>
      <div class="private-messages" id="private-messages-${targetUsername}"></div>
      <div class="chat-input">
        <input type="text" id="private-message-input-${targetUsername}" placeholder="Digite uma mensagem" autocomplete="off" />
        <button class="btn btn-primary private-send-button" data-recipient="${targetUsername}">Enviar</button>
      </div>
    `;

    chatContainer.appendChild(privateChatContainer);

    // Event listener to close the private chat
    const closeBtn = privateChatContainer.querySelector('.close-private-chat');
    closeBtn.addEventListener('click', () => {
      privateChatContainer.style.display = 'none';
    });

    // Event listener to send private messages
    const privateSendButton = privateChatContainer.querySelector('.private-send-button');
    privateSendButton.addEventListener('click', () => {
      const recipient = privateSendButton.getAttribute('data-recipient');
      sendPrivateMessage(recipient);
    });

    // Store the private chat in the mapping
    privateChats[targetUsername] = {
      container: privateChatContainer,
      messagesDiv: privateChatContainer.querySelector(`#private-messages-${targetUsername}`),
      input: privateChatContainer.querySelector(`#private-message-input-${targetUsername}`),
      typingTimeout: null
    };
  }
}

function sendPrivateMessage(targetUsername) {
  const privateChat = privateChats[targetUsername];
  if (!privateChat) {
    console.error(`Chat privado com ${targetUsername} não encontrado.`);
    return;
  }

  const messageInput = privateChat.input;
  const messageText = messageInput.value.trim();

  if (messageText === '') {
    return;
  }

  const message = {
    type: 'private_message',
    recipient: targetUsername,
    text: messageText,
  };

  ws.send(JSON.stringify(message)); // Envia via WebSocket
  messageInput.value = ''; // Limpa o campo de entrada

  // Display the sent message immediately
  displayPrivateMessage(username, messageText, targetUsername);
}

function receivePrivateMessage(user, text, recipient) {
  // recipient is who the message is intended for
  // if recipient is username, it means it's a private message to me
  const chatWithUser = user; // The sender

  if (privateChats[chatWithUser] && privateChats[chatWithUser].container.style.display !== 'none') {
    // If private chat with sender is open, display the message
    displayPrivateMessage(user, text, chatWithUser);
  } else {
    // If private chat is not open, increment the unread badge
    incrementUnreadMessages(user);
  }
}

function displayPrivateMessage(user, text, targetUsername) {
  const privateChat = privateChats[targetUsername];
  if (!privateChat) {
    // Chat not open, do not display
    return;
  }

  const messageElem = document.createElement('div');
  messageElem.classList.add('message', user === username ? 'user' : 'other');

  // Detecta URLs e transforma em hyperlinks clicáveis
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let messageText = text.replace(urlRegex, function (url) {
    if (url.endsWith('.gif')) {
      return `<img src="${url}" alt="GIF" style="max-width: 200px; max-height: 200px;" />`;
    } else {
      return `<a href="${url}" target="_blank">${url}</a>`;
    }
  });

  const time = new Date().toLocaleString('pt-BR');
  messageElem.innerHTML = `<strong>${user}</strong> <small>(${time})</small>: ${messageText}`;
  privateChat.messagesDiv.appendChild(messageElem);
  privateChat.messagesDiv.scrollTop = privateChat.messagesDiv.scrollHeight;
}

// Handle typing indicator for private chats
function handlePrivateTyping(recipient) {
  const privateChat = privateChats[recipient];
  if (privateChat && privateChat.container.style.display !== 'none') {
    // Show typing indicator in the private chat
    privateChat.container.querySelector('.typing-indicator')?.remove(); // Remove existing
    const typingIndicator = document.createElement('div');
    typingIndicator.classList.add('typing-indicator');
    typingIndicator.textContent = `${recipient} está digitando...`;
    privateChat.container.insertBefore(typingIndicator, privateChat.container.querySelector('.chat-input'));

    clearTimeout(privateChat.typingTimeout);
    privateChat.typingTimeout = setTimeout(() => {
      typingIndicator.remove();
    }, typingTimeoutDuration);
  }
}

// Event listeners for typing in private chats
function setupPrivateChatTypingListener(targetUsername) {
  const privateChat = privateChats[targetUsername];
  if (privateChat) {
    privateChat.input.addEventListener('keypress', (event) => {
      if (!typing) {
        typing = true;
        ws.send(JSON.stringify({ type: 'typing', user: username, recipient: targetUsername }));
      }
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        typing = false;
      }, typingTimeoutDuration);

      if (event.key === 'Enter') {
        sendPrivateMessage(targetUsername);
        typing = false;
      }
    });
  }
}

sendButton.addEventListener('click', () => {
  sendMessage();
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

// Observe new private chats and setup typing listeners
const observer = new MutationObserver((mutationsList) => {
  for (const mutation of mutationsList) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node.classList && node.classList.contains('private-chat-container')) {
          const sendButton = node.querySelector('.private-send-button');
          const recipient = sendButton.getAttribute('data-recipient');
          setupPrivateChatTypingListener(recipient);
        }
      });
    }
  }
});

observer.observe(chatContainer, { childList: true });
