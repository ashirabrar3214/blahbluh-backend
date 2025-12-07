const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());

const queue = [];
const activeChats = new Map();
const userSockets = new Map();

const adjectives = ['Happy', 'Silly', 'Brave', 'Clever', 'Funny', 'Cool', 'Swift', 'Bright', 'Wild', 'Gentle'];
const nouns = ['Panda', 'Tiger', 'Eagle', 'Dolphin', 'Fox', 'Wolf', 'Bear', 'Lion', 'Shark', 'Raven'];

// FIXED: Changed from POST to GET
app.get('/api/generate-user-id', (req, res) => {
  const userId = uuidv4();
  const username = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
  res.json({ userId, username });
});

app.post('/api/join-queue', (req, res) => {
  const { userId, username } = req.body;
  const socket = userSockets.get(userId);
  
  if (socket && socket.connected && !queue.find(u => u.userId === userId)) {
    queue.push({ userId, username });
    setTimeout(tryMatchUsers, 500);
  }
  const position = queue.findIndex(u => u.userId === userId) + 1;
  res.json({ userId, username, queuePosition: position });
});

app.post('/api/leave-queue', (req, res) => {
  const { userId } = req.body;
  const index = queue.findIndex(u => u.userId === userId);
  if (index !== -1) queue.splice(index, 1);
  res.json({ success: true });
});

app.get('/api/queue-status/:userId', (req, res) => {
  const { userId } = req.params;
  const index = queue.findIndex(u => u.userId === userId);
  res.json({ inQueue: index !== -1, queuePosition: index + 1 });
});

function tryMatchUsers() {
  while (queue.length >= 2) {
    const user1 = queue[0];
    const user2 = queue[1];
    const socket1 = userSockets.get(user1.userId);
    const socket2 = userSockets.get(user2.userId);

    if (!socket1?.connected || !socket2?.connected) {
      if (!socket1?.connected) queue.shift();
      if (queue.length > 1 && !socket2?.connected) queue.splice(1, 1);
      continue;
    }

    queue.splice(0, 2);
    const chatId = uuidv4();
    activeChats.set(chatId, { users: [user1, user2], messages: [] });

    socket1.emit('chat-paired', { chatId, users: [user1, user2] });
    socket2.emit('chat-paired', { chatId, users: [user1, user2] });
  }
}

io.on('connection', (socket) => {
  socket.on('register-user', ({ userId }) => {
    userSockets.set(userId, socket);
    console.log(`User registered: ${userId} -> ${socket.id}`);
    socket.emit('registration-confirmed', { userId });
  });

  socket.on('join-chat', ({ chatId }) => {
    socket.join(chatId);
  });

  socket.on('send-message', ({ chatId, message, userId, username }) => {
    const messageData = {
      id: uuidv4(),
      chatId,
      message,
      userId,
      username,
      timestamp: Date.now()
    };
    io.to(chatId).emit('new-message', messageData);
  });

  socket.on('disconnect', () => {
    for (const [userId, sock] of userSockets.entries()) {
      if (sock === socket) {
        userSockets.delete(userId);
        const index = queue.findIndex(u => u.userId === userId);
        if (index !== -1) queue.splice(index, 1);
        console.log(`User disconnected and removed: ${userId}`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit: https://blahbluh-production.up.railway.app/api/generate-user-id`);
});