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

console.log('🚀 Server initializing...');

// Root endpoint
app.get('/', (req, res) => {
  console.log('📍 Root endpoint accessed');
  res.json({ message: 'BlahBluh Backend API is running!' });
});

// Hello World API endpoint
app.get('/api/hello', (req, res) => {
  console.log('👋 Hello endpoint accessed');
  res.json({ message: 'Hello World!' });
});

// Generate random user ID
app.get('/api/generate-user-id', (req, res) => {
  const randomUserId = uuidv4();
  console.log('🆔 Generated random user ID:', randomUserId);
  res.json({ userId: randomUserId });
});

// Join queue for random chat
app.post('/api/join-queue', (req, res) => {
  console.log('🔄 Join queue request received:', req.body);
  
  let { userId, username } = req.body;
  
  // Generate random userId if not provided
  if (!userId) {
    userId = uuidv4();
    console.log('🆔 Generated random userId for user:', userId);
  }
  
  if (!username) {
    console.log('❌ Username missing in join queue request');
    return res.status(400).json({ error: 'username required' });
  }

  // Check if user already in queue
  if (waitingUsers.find(u => u.userId === userId)) {
    console.log('⚠️ User already in queue:', userId);
    return res.json({ message: 'Already in queue', inQueue: true, userId });
  }

  const user = { userId, username, joinedAt: Date.now() };
  waitingUsers.push(user);
  users.set(userId, user);
  
  console.log('✅ User added to queue:', userId, 'Username:', username);
  console.log('📊 Current queue length:', waitingUsers.length);
  console.log('👥 Users in queue:', waitingUsers.map(u => `${u.username}(${u.userId})`));

  res.json({ 
    message: 'Added to queue', 
    inQueue: true, 
    queuePosition: waitingUsers.length,
    userId 
  });
});

// Leave queue
app.post('/api/leave-queue', (req, res) => {
  const { userId } = req.body;
  console.log('🚪 Leave queue request for userId:', userId);
  
  const beforeLength = waitingUsers.length;
  waitingUsers = waitingUsers.filter(u => u.userId !== userId);
  const afterLength = waitingUsers.length;
  
  console.log('📊 Queue length before:', beforeLength, 'after:', afterLength);
  res.json({ message: 'Left queue', inQueue: false });
});

// Get queue status
app.get('/api/queue-status/:userId', (req, res) => {
  const { userId } = req.params;
  console.log('📊 Queue status request for userId:', userId);
  
  const inQueue = waitingUsers.some(u => u.userId === userId);
  const position = waitingUsers.findIndex(u => u.userId === userId) + 1;
  
  console.log('📍 User in queue:', inQueue, 'Position:', position);
  
  res.json({ 
    inQueue, 
    queuePosition: position || 0,
    totalInQueue: waitingUsers.length 
  });
});

// Socket.IO for real-time chat
io.on('connection', (socket) => {
  console.log('🔌 User connected with socket ID:', socket.id);

  socket.on('join-chat', (data) => {
    const { userId, chatId } = data;
    console.log('🏠 User joining chat - UserId:', userId, 'ChatId:', chatId);
    socket.join(chatId);
    socket.userId = userId;
    socket.chatId = chatId;
    console.log('✅ User successfully joined chat room:', chatId);
  });

  socket.on('send-message', (data) => {
    const { chatId, message, userId, username } = data;
    console.log('💬 Message received - From:', username, 'UserId:', userId, 'ChatId:', chatId);
    console.log('📝 Message content:', message);
    
    const messageData = {
      id: uuidv4(),
      message,
      userId,
      username,
      timestamp: Date.now()
    };
    
    console.log('📤 Broadcasting message to chat:', chatId);
    io.to(chatId).emit('new-message', messageData);
  });

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected - Socket ID:', socket.id);
    if (socket.userId) {
      console.log('🚪 Removing user from queue - UserId:', socket.userId);
      const beforeLength = waitingUsers.length;
      waitingUsers = waitingUsers.filter(u => u.userId !== socket.userId);
      console.log('📊 Queue length after disconnect - Before:', beforeLength, 'After:', waitingUsers.length);
    }
  });
});

// Pairing logic - runs every 2 seconds
setInterval(() => {
  if (waitingUsers.length >= 2) {
    console.log('🔄 Pairing process started - Users in queue:', waitingUsers.length);
    
    const user1 = waitingUsers.shift();
    const user2 = waitingUsers.shift();
    
    console.log('👥 Pairing users:', user1.username, '(', user1.userId, ') with', user2.username, '(', user2.userId, ')');
    
    const chatId = uuidv4();
    const chat = {
      id: chatId,
      users: [user1, user2],
      createdAt: Date.now(),
      messages: []
    };
    
    activeChats.set(chatId, chat);
    console.log('💬 Created new chat room:', chatId);
    console.log('📊 Active chats count:', activeChats.size);
    
    // Notify users they've been paired
    console.log('📢 Broadcasting pairing notification to all clients');
    io.emit('chat-paired', {
      chatId,
      users: [user1, user2]
    });
    
    console.log('✅ Pairing completed successfully');
  } else if (waitingUsers.length > 0) {
    console.log('⏳ Waiting for more users - Current queue:', waitingUsers.length);
  }
}, 2000);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});