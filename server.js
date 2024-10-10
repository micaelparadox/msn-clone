const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables

// Connect to MongoDB using the connection string from the environment
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => console.log('MongoDB connection error:', error));

// Define schemas
const UserSchema = new mongoose.Schema({
  username: String,
  status: { type: String, default: 'online' } // Add status field to user
});

const MessageSchema = new mongoose.Schema({
  user: String,
  text: String,
  timestamp: Date,
  recipient: String, // For private messages, store the recipient
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Mapping of active WebSocket clients
const clients = new Map();

// Function to broadcast updated user list
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

// Manage WebSocket connection
wss.on('connection', (ws) => {
  console.log('New client connected');

  // Set default user status to 'online'
  ws.status = 'online';

  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    console.log('Received:', data);

    if (data.type === 'join') {
      if (!data.username) {
        console.log('Error: Username not provided');
        return;
      }

      // Normalize username to avoid case sensitivity issues
      ws.username = data.username.toLowerCase();
      console.log(`Client connected: ${ws.username}`);  // Confirm user assignment
      clients.set(ws.username, ws);

      // Check if the user exists in the database and update their status
      let user = await User.findOne({ username: ws.username });
      if (!user) {
        user = new User({ username: ws.username, status: ws.status });
        await user.save();
      } else {
        // Update the status of the existing user
        user.status = 'online';
        await user.save();
      }

      // Broadcast updated user list to all clients
      broadcastUserList();
    }

    // Handle public or private messages
    else if (data.type === 'message' || data.type === 'private_message') {
      const chatMessage = new Message({
        user: ws.username,
        text: data.text,
        timestamp: new Date(),
        recipient: data.recipient ? data.recipient.toLowerCase() : null, // Normalize recipient name
      });
      await chatMessage.save();

      if (data.type === 'message') {
        // Public message
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'message', data: chatMessage }));
          }
        });
      } else {
        // Private message
        const recipientUsername = data.recipient.toLowerCase();
        const recipientWs = clients.get(recipientUsername);
        console.log(`Sending private message from ${ws.username} to ${recipientUsername}`);

        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          recipientWs.send(JSON.stringify({ type: 'private_message', data: chatMessage }));
          ws.send(JSON.stringify({ type: 'private_message', data: chatMessage })); // Send confirmation to the sender
        } else {
          console.log(`User ${recipientUsername} is unavailable or offline`);
        }
      }
    }

    // Notify that the user is typing
    else if (data.type === 'typing') {
      if (ws.username) {
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'typing', data: { user: ws.username } }));
          }
        });
      } else {
        console.log('Error: Attempt to notify typing without a username set');
      }
    }

    // Change user status (online, away, busy)
    else if (data.type === 'change_status') {
      if (!ws.username) {
        console.log('Error: Username not defined when trying to change status');
        return;
      }

      const validStatuses = ['online', 'away', 'busy'];
      if (validStatuses.includes(data.status)) {
        ws.status = data.status; // Update the WebSocket user's status
        console.log(`${ws.username} changed status to ${ws.status}`);

        // Update the user's status in the database
        let user = await User.findOne({ username: ws.username });
        if (user) {
          user.status = ws.status;
          await user.save();
        }

        // Broadcast updated user list to all clients
        broadcastUserList();
      } else {
        console.log(`Invalid status: ${data.status}`);
      }
    }
  });

  ws.on('close', async () => {
    // Ensure the user exists before deleting
    if (ws.username) {
      clients.delete(ws.username);
      console.log(`Client ${ws.username} disconnected`);

      // Update the user's status to offline in the database
      let user = await User.findOne({ username: ws.username });
      if (user) {
        user.status = 'offline';
        await user.save();
      }

      // Broadcast the updated user list when someone leaves
      broadcastUserList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
