const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
require('dotenv').config(); // Carrega variáveis de ambiente

// Conecta ao MongoDB usando a string de conexão do ambiente
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
  });

// Define os schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  status: { type: String, default: 'online' } // Campo de status do usuário
});

const MessageSchema = new mongoose.Schema({
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  recipient: String, // Para mensagens privadas, armazena o destinatário
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Mapeamento de clientes WebSocket ativos
const clients = new Map();

// Função para broadcast da lista atualizada de usuários
function broadcastUserList() {
  const userList = Array.from(clients.values()).map((client) => ({
    username: client.username,
    status: client.status
  }));

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'users', data: userList }));
    }
  });
}

app.use(express.static('public'));

// Função auxiliar para validar username
function isValidUsername(username) {
  // Usernames devem ser alfanuméricos e entre 3-20 caracteres
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
}

// Gerencia a conexão WebSocket
wss.on('connection', (ws) => {
  console.log('New client connected');

  // Define status padrão como 'online'
  ws.status = 'online';

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data);

      // Manipula o tipo de mensagem
      if (data.type === 'join') {
        if (!data.username) {
          console.log('Error: Username not provided');
          ws.send(JSON.stringify({ type: 'error', message: 'Username not provided' }));
          return;
        }

        // Normaliza o username para evitar problemas com case sensitivity
        const normalizedUsername = data.username.toLowerCase();

        // Valida o username
        if (!isValidUsername(normalizedUsername)) {
          console.log('Error: Invalid username provided');
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid username' }));
          return;
        }

        // Verifica se o username já está em uso
        if (clients.has(normalizedUsername)) {
          console.log(`Error: Username ${normalizedUsername} is already taken`);
          ws.send(JSON.stringify({ type: 'error', message: 'Username already taken' }));
          return;
        }

        ws.username = normalizedUsername;
        console.log(`Client connected: ${ws.username}`);
        clients.set(ws.username, ws);

        // Verifica se o usuário já existe no banco de dados e atualiza o status
        let user = await User.findOne({ username: ws.username });
        if (!user) {
          user = new User({ username: ws.username, status: ws.status });
          await user.save();
        } else {
          // Atualiza o status do usuário existente
          user.status = 'online';
          await user.save();
        }

        // Broadcast da lista atualizada de usuários para todos os clientes
        broadcastUserList();
      }

      // Manipula mensagens públicas ou privadas
      else if (data.type === 'message' || data.type === 'private_message') {
        if (!ws.username) {
          console.log('Error: User not joined yet');
          ws.send(JSON.stringify({ type: 'error', message: 'User not joined yet' }));
          return;
        }

        // Para mensagens privadas, garante que o destinatário esteja especificado
        if (data.type === 'private_message' && !data.recipient) {
          console.log('Error: Recipient not specified for private message');
          ws.send(JSON.stringify({ type: 'error', message: 'Recipient not specified' }));
          return;
        }

        const chatMessage = new Message({
          user: ws.username,
          text: data.text,
          timestamp: new Date(),
          recipient: data.recipient ? data.recipient.toLowerCase() : null, // Normaliza o nome do destinatário
        });
        await chatMessage.save();

        if (data.type === 'message') {
          // Mensagem pública: broadcast para todos os clientes
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'message', data: chatMessage }));
            }
          });
        } else {
          // Mensagem privada: envia apenas para o destinatário e remetente
          const recipientUsername = data.recipient.toLowerCase();
          const recipientWs = clients.get(recipientUsername);
          console.log(`Sending private message from ${ws.username} to ${recipientUsername}`);

          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify({ type: 'private_message', data: chatMessage }));
            ws.send(JSON.stringify({ type: 'private_message', data: chatMessage })); // Envia confirmação para o remetente
          } else {
            console.log(`User ${recipientUsername} is unavailable or offline`);
            ws.send(JSON.stringify({ type: 'error', message: `User ${recipientUsername} is unavailable or offline` }));
          }
        }
      }

      // Manipula indicadores de digitação
      else if (data.type === 'typing') {
        if (ws.username) {
          // Se for um chat privado, envia para o destinatário específico
          if (data.recipient) {
            const recipientUsername = data.recipient.toLowerCase();
            const recipientWs = clients.get(recipientUsername);
            if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
              recipientWs.send(JSON.stringify({ type: 'typing', data: { user: ws.username, recipient: ws.username } }));
            }
          } else {
            // Para chat público, notifica todos os outros clientes
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'typing', data: { user: ws.username } }));
              }
            });
          }
        } else {
          console.log('Error: Attempt to notify typing without a username set');
        }
      }

      // Manipula solicitação para carregar mensagens privadas
      else if (data.type === 'load_private_messages') {
        if (!ws.username) {
          console.log('Error: User not joined yet');
          ws.send(JSON.stringify({ type: 'error', message: 'User not joined yet' }));
          return;
        }

        const recipientUsername = data.recipient.toLowerCase();

        // Verifica se o destinatário existe
        const recipientUser = await User.findOne({ username: recipientUsername });
        if (!recipientUser) {
          console.log(`Error: Recipient ${recipientUsername} not found`);
          ws.send(JSON.stringify({ type: 'error', message: `Recipient ${recipientUsername} not found` }));
          return;
        }

        // Carrega mensagens entre ws.username e recipientUsername
        const messages = await Message.find({
          $or: [
            { user: ws.username, recipient: recipientUsername },
            { user: recipientUsername, recipient: ws.username }
          ]
        }).sort({ timestamp: 1 }); // Ordena por timestamp ascendente

        ws.send(JSON.stringify({ type: 'private_messages', data: messages, recipient: recipientUsername }));
      }

      // Manipula mudança de status do usuário
      else if (data.type === 'change_status') {
        if (!ws.username) {
          console.log('Error: Username not defined when trying to change status');
          ws.send(JSON.stringify({ type: 'error', message: 'Username not defined' }));
          return;
        }

        const validStatuses = ['online', 'away', 'busy'];
        if (validStatuses.includes(data.status)) {
          ws.status = data.status; // Atualiza o status do usuário no WebSocket
          console.log(`${ws.username} changed status to ${ws.status}`);

          // Atualiza o status do usuário no banco de dados
          let user = await User.findOne({ username: ws.username });
          if (user) {
            user.status = ws.status;
            await user.save();
          }

          // Broadcast da lista atualizada de usuários para todos os clientes
          broadcastUserList();
        } else {
          console.log(`Invalid status: ${data.status}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid status' }));
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
    }
  });

  ws.on('close', async () => {
    // Garante que o usuário existe antes de remover
    if (ws.username) {
      clients.delete(ws.username);
      console.log(`Client ${ws.username} disconnected`);

      // Atualiza o status do usuário para offline no banco de dados
      let user = await User.findOne({ username: ws.username });
      if (user) {
        user.status = 'offline';
        await user.save();
      }

      // Broadcast da lista atualizada de usuários quando alguém sai
      broadcastUserList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
