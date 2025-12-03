const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// In-memory storage
let waitingUsers = [];
let activeChats = new Map();
let users = new Map();

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'BlahBluh Backend API is running!' });
});

// Hello World API endpoint
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello World!' });
});

// Join queue for random chat
app.post('/api/join-queue', (req, res) => {
  const { userId, username } = req.body;
  
  if (!userId || !username) {
    return res.status(400).json({ error: 'userId and username required' });
  }

  // Check if user already in queue
  if (waitingUsers.find(u => u.userId === userId)) {
    return res.json({ message: 'Already in queue', inQueue: true });
  }

  const user = { userId, username, joinedAt: Date.now() };
  waitingUsers.push(user);
  users.set(userId, user);

  res.json({ message: 'Added to queue', inQueue: true, queuePosition: waitingUsers.length });
});

// Leave queue
app.post('/api/leave-queue', (req, res) => {
  const { userId } = req.body;
  waitingUsers = waitingUsers.filter(u => u.userId !== userId);
  res.json({ message: 'Left queue', inQueue: false });
});

// Get queue status
app.get('/api/queue-status/:userId', (req, res) => {
  const { userId } = req.params;
  const inQueue = waitingUsers.some(u => u.userId === userId);
  const position = waitingUsers.findIndex(u => u.userId === userId) + 1;
  
  res.json({ 
    inQueue, 
    queuePosition: position || 0,
    totalInQueue: waitingUsers.length 
  });
});

// Socket.IO for real-time chat
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-chat', (data) => {
    const { userId, chatId } = data;
    socket.join(chatId);
    socket.userId = userId;
    socket.chatId = chatId;
  });

  socket.on('send-message', (data) => {
    const { chatId, message, userId, username } = data;
    const messageData = {
      id: uuidv4(),
      message,
      userId,
      username,
      timestamp: Date.now()
    };
    
    io.to(chatId).emit('new-message', messageData);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.userId) {
      waitingUsers = waitingUsers.filter(u => u.userId !== socket.userId);
    }
  });
});

// Pairing logic - runs every 2 seconds
setInterval(() => {
  while (waitingUsers.length >= 2) {
    const user1 = waitingUsers.shift();
    const user2 = waitingUsers.shift();
    
    const chatId = uuidv4();
    const chat = {
      id: chatId,
      users: [user1, user2],
      createdAt: Date.now(),
      messages: []
    };
    
    activeChats.set(chatId, chat);
    
    // Notify users they've been paired
    io.emit('chat-paired', {
      chatId,
      users: [user1, user2]
    });
  }
}, 2000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});