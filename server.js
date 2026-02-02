require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const userRoutes = require('./routes/userRoutes');
const { router: chatRoutes, queue } = require('./routes/chatRoutes');
const friendRoutes = require('./routes/friendRoutes');
const moderationRoutes = require('./routes/moderationRoutes');
const gifRoutes = require('./routes/gifRoutes');
const socketService = require('./services/socketService');
const gifService = require('./services/gifService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Track connected users for notifications
const connectedUsers = new Map(); // userId -> socketId

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', userRoutes);
app.use('/api', chatRoutes);
app.use('/api', friendRoutes);
// This adds the "/moderation" prefix to all routes in that file
app.use('/api/moderation', moderationRoutes);
app.use('/api/gifs', gifRoutes);

// Make io and connectedUsers globally accessible for notifications
global.io = io;
global.connectedUsers = connectedUsers;

// Socket handling
io.on('connection', (socket) => {
  console.log(`[SOCKET] New connection: ${socket.id}`);
  socketService.handleConnection(io, socket, queue);
  
  // Track user connections for notifications
  socket.on('register-user', ({ userId }) => {
    connectedUsers.set(userId, socket.id);
    console.log(`[SOCKET] User registered: ${userId} (Socket: ${socket.id})`);
    console.log(`[SOCKET] Total connected users: ${connectedUsers.size}`);
  });
  
  socket.on('disconnect', () => {
    // Remove user from connected users
    for (let [userId, socketId] of connectedUsers.entries()) {
      if (socketId === socket.id) {
        connectedUsers.delete(userId);
        console.log(`[SOCKET] User disconnected: ${userId}`);
        console.log(`[SOCKET] Total connected users: ${connectedUsers.size}`);
        break;
      }
    }
  });
});

// Match users every 500ms
setInterval(async () => {
  await socketService.tryMatchUsers(queue);
}, 500);

// Initialize the cache on server start
gifService.init();

const PORT = process.env.PORT || 3000;
server.listen(PORT,'0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API: https://blahbluh-production.up.railway.app/api/generate-user-id`);
});