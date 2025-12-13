const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const userRoutes = require('./routes/userRoutes');
const { router: chatRoutes, queue } = require('./routes/chatRoutes');
const socketService = require('./services/socketService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', userRoutes);
app.use('/api', chatRoutes);

// Socket handling
io.on('connection', (socket) => {
  socketService.handleConnection(io, socket, queue);
});

// Match users every 500ms
setInterval(() => {
  socketService.tryMatchUsers(queue);
}, 500);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit: https://blahbluh-production.up.railway.app/api/generate-user-id`);
});