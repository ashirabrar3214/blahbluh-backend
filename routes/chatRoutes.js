const express = require('express');
const userService = require('../services/userService');
const socketService = require('../services/socketService');
const router = express.Router();

const queue = [];

router.post('/join-queue', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await userService.getUser(userId);
    
    if (!queue.find(u => u.userId === userId)) {
      queue.push({ userId: user.id, username: user.username });
      console.log(`[QUEUE] User ${userId} (${user.username}) joined queue. Total: ${queue.length}`);
    }
    
    const position = queue.findIndex(u => u.userId === userId) + 1;
    res.json({ userId: user.id, username: user.username, queuePosition: position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/leave-queue', (req, res) => {
  const { userId } = req.body;
  const index = queue.findIndex(u => u.userId === userId);
  if (index !== -1) {
    queue.splice(index, 1);
    console.log(`[QUEUE] User ${userId} left queue. Total: ${queue.length}`);
  }
  res.json({ success: true });
});

router.get('/queue-status/:userId', (req, res) => {
  const { userId } = req.params;
  const index = queue.findIndex(u => u.userId === userId);
  res.json({ inQueue: index !== -1, queuePosition: index + 1 });
});

router.post('/exit', async (req, res) => {
  try {
    const { userId } = req.body;
    
    // Remove user from queue if present
    const index = queue.findIndex(u => u.userId === userId);
    if (index !== -1) {
      queue.splice(index, 1);
      console.log(`[QUEUE] User ${userId} left queue via exit.`);
    }

    // Find active chat involving this user
    let targetChatId = null;
    for (const [chatId, chatData] of socketService.activeChats.entries()) {
      if (chatData.users.some(u => (u.userId || u.id) === userId)) {
        targetChatId = chatId;
        
        // Handle partner
        const partner = chatData.users.find(u => (u.userId || u.id) !== userId);
        if (partner) {
          const partnerId = partner.userId || partner.id;
          const partnerSocket = socketService.userSockets.get(partnerId);
          
          if (partnerSocket?.connected) {
            // Notify partner
            partnerSocket.emit('partner-disconnected', {
              chatId,
              reason: 'partner-exit',
              shouldRequeue: true,
              byUserId: userId
            });
            partnerSocket.leave(chatId);
            
            // Requeue partner
            const result = await socketService.joinQueue(partnerId, partnerSocket.id, queue);
            partnerSocket.emit('queue-joined', result);
          }
        }
        break;
      }
    }

    if (targetChatId) {
      const mySocket = socketService.userSockets.get(userId);
      if (mySocket) mySocket.leave(targetChatId);
      socketService.activeChats.delete(targetChatId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Exit route error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, queue };