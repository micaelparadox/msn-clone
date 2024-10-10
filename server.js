const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');

// Conectar ao MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp');

// Definir schemas
const UserSchema = new mongoose.Schema({
  username: String,
  status: { type: String, default: 'online' } // Adicionar campo de status ao usuário
});

const MessageSchema = new mongoose.Schema({
  user: String,
  text: String,
  timestamp: Date,
  recipient: String, // Para mensagens privadas, armazenamos o destinatário
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Mapeamento de clientes WebSocket ativos
const clients = new Map();

// Função para enviar lista atualizada de usuários com status
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

// Gerenciar conexão WebSocket
wss.on('connection', (ws) => {
  console.log('Novo cliente conectado');

  // Definir o status padrão do usuário como 'online'
  ws.status = 'online';

  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    console.log('Recebido:', data);

    if (data.type === 'join') {
      if (!data.username) {
        console.log('Erro: Nome de usuário não fornecido');
        return;
      }

      // Normalizar o nome de usuário para evitar problemas com maiúsculas/minúsculas
      ws.username = data.username.toLowerCase();
      console.log(`Cliente conectado: ${ws.username}`);  // Confirmação de que o usuário foi atribuído corretamente
      clients.set(ws.username, ws);

      // Verificar se o usuário já está no banco de dados e atualizar o status
      let user = await User.findOne({ username: ws.username });
      if (!user) {
        user = new User({ username: ws.username, status: ws.status });
        await user.save();
      } else {
        // Atualizar status do usuário existente
        user.status = 'online';
        await user.save();
      }

      // Enviar a lista atualizada de usuários a todos os clientes
      broadcastUserList();
    }

    // Enviar mensagem pública ou privada
    else if (data.type === 'message' || data.type === 'private_message') {
      const chatMessage = new Message({
        user: ws.username,
        text: data.text,
        timestamp: new Date(),
        recipient: data.recipient ? data.recipient.toLowerCase() : null, // Normalizar o nome do destinatário
      });
      await chatMessage.save();

      if (data.type === 'message') {
        // Mensagem pública
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'message', data: chatMessage }));
          }
        });
      } else {
        // Mensagem privada
        const recipientUsername = data.recipient.toLowerCase();
        const recipientWs = clients.get(recipientUsername);
        console.log(`Enviando mensagem privada de ${ws.username} para ${recipientUsername}`);

        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          recipientWs.send(JSON.stringify({ type: 'private_message', data: chatMessage }));
          ws.send(JSON.stringify({ type: 'private_message', data: chatMessage })); // Enviar confirmação ao remetente
        } else {
          console.log(`Usuário ${recipientUsername} não está disponível ou offline`);
        }
      }
    }

    // Notificar que o usuário está digitando
    else if (data.type === 'typing') {
      if (ws.username) {
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'typing', data: { user: ws.username } }));
          }
        });
      } else {
        console.log('Erro: Tentativa de notificar digitação sem nome de usuário definido');
      }
    }

    // Alterar status do usuário (online, ausente, ocupado)
    else if (data.type === 'change_status') {
      if (!ws.username) {
        console.log('Erro: Nome de usuário não definido ao tentar mudar o status');
        return;
      }

      const validStatuses = ['online', 'away', 'busy'];
      if (validStatuses.includes(data.status)) {
        ws.status = data.status; // Atualizar o status do WebSocket do usuário
        console.log(`${ws.username} mudou status para ${ws.status}`);

        // Atualizar o status do usuário no banco de dados
        let user = await User.findOne({ username: ws.username });
        if (user) {
          user.status = ws.status;
          await user.save();
        }

        // Enviar a lista atualizada de usuários a todos os clientes
        broadcastUserList();
      } else {
        console.log(`Status inválido: ${data.status}`);
      }
    }
  });

  ws.on('close', async () => {
    // Verificar se o usuário existe antes de deletar
    if (ws.username) {
      clients.delete(ws.username);
      console.log(`Cliente ${ws.username} desconectado`);

      // Atualizar status do usuário para offline no banco de dados
      let user = await User.findOne({ username: ws.username });
      if (user) {
        user.status = 'offline';
        await user.save();
      }

      // Atualizar a lista de usuários quando alguém sair
      broadcastUserList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor está ouvindo na porta ${PORT}`);
});
