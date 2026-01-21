const express = require('express');
const userService = require('../services/userService');
const socketService = require('../services/socketService');
const geminiService = require('./geminiService');
const router = express.Router();
const banGuard = require('../middleware/banGuard');

const queue = [];

router.post('/join-queue', banGuard, async (req, res) => {
  try {
    const { userId } = req.body;

    // ✅ FIX: Ensure user exists in DB before joining queue
    await userService.promoteGuest(userId);

    console.log(`[ChatRoutes] 'join-queue' request for userId: ${userId}`);
    const user = await userService.getUser(userId);
    
    if (!queue.find(u => u.userId === userId)) {
      queue.push({ userId: user.id, username: user.username });
      console.log(`[QUEUE] User ${userId} (${user.username}) joined queue. Total: ${queue.length}`);
    } else {
      console.log(`[ChatRoutes] User ${userId} already in queue.`);
    }
    
    const position = queue.findIndex(u => u.userId === userId) + 1;
    console.log(`[ChatRoutes] Sending queue response for ${userId}. Position: ${position}`);
    res.json({ userId: user.id, username: user.username, queuePosition: position });
  } catch (error) {
    console.error(`[ChatRoutes] Error in join-queue:`, error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/leave-queue', (req, res) => {
  const { userId } = req.body;
  console.log(`[ChatRoutes] 'leave-queue' request for userId: ${userId}`);
  const index = queue.findIndex(u => u.userId === userId);
  if (index !== -1) {
    queue.splice(index, 1);
    console.log(`[QUEUE] User ${userId} left queue. Total: ${queue.length}`);
  } else {
    console.log(`[ChatRoutes] User ${userId} not found in queue to leave.`);
  }
  res.json({ success: true });
});

router.get('/queue-status/:userId', (req, res) => {
  const { userId } = req.params;
  // console.log(`[ChatRoutes] 'queue-status' check for userId: ${userId}`);
  const index = queue.findIndex(u => u.userId === userId);
  // console.log(`[ChatRoutes] User ${userId} in queue: ${index !== -1}, Pos: ${index + 1}`);
  res.json({ inQueue: index !== -1, queuePosition: index + 1 });
});

router.post('/exit', async (req, res) => {
  try {
    const { userId } = req.body;
    console.log(`[ChatRoutes] 'exit' request for userId: ${userId}`);
    
    // Remove user from queue if present
    const index = queue.findIndex(u => u.userId === userId);
    if (index !== -1) {
      queue.splice(index, 1);
      console.log(`[QUEUE] User ${userId} left queue via exit.`);
    }

    // Find active chat involving this user
    let targetChatId = null;
    console.log(`[ChatRoutes] Searching for active chat for user ${userId}`);
    for (const [chatId, chatData] of socketService.activeChats.entries()) {
      if (chatData.users.some(u => (u.userId || u.id) === userId)) {
        targetChatId = chatId;
        console.log(`[ChatRoutes] Found active chat ${chatId} for user ${userId}`);
        
        // Remove chat immediately to prevent race conditions (double exit/requeue)
        socketService.activeChats.delete(chatId);

        // Handle partner
        const partner = chatData.users.find(u => (u.userId || u.id) !== userId);
        if (partner) {
          const partnerId = partner.userId || partner.id;
          console.log(`[ChatRoutes] Identified partner ${partnerId}`);
          const partnerSocket = socketService.userSockets.get(partnerId);
          
          if (partnerSocket?.connected) {
            console.log(`[ChatRoutes] Notifying partner ${partnerId} of exit`);
            // Notify partner
            partnerSocket.emit('partner-disconnected', {
              chatId,
              reason: 'partner-exit',
              shouldRequeue: true,
              byUserId: userId
            });
            partnerSocket.leave(chatId);
            
            // Requeue partner
            if (!queue.find(u => u.userId === partnerId)) {
              console.log(`[ChatRoutes] Requeueing partner ${partnerId}`);
              const result = await socketService.joinQueue(partnerId, partnerSocket.id, queue);
              partnerSocket.emit('queue-joined', result);
            } else {
              console.log(`[ChatRoutes] Partner ${partnerId} already in queue, skipping requeue.`);
            }
          } else {
            console.log(`[ChatRoutes] Partner ${partnerId} socket not connected`);
          }
        }
        break;
      }
    }

    if (targetChatId) {
      console.log(`[ChatRoutes] Cleaning up chat ${targetChatId}`);
      const mySocket = socketService.userSockets.get(userId);
      if (mySocket) mySocket.leave(targetChatId);
    } else {
      console.log(`[ChatRoutes] No active chat found for user ${userId} to exit`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Exit route error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /update-interests
// Updates the user's interests array in the database
router.post('/update-interests', async (req, res) => {
  try {
    const { userId, tags } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId.' });
    }

    // Validation: Ensure tags are provided and are in an array format
    if (!tags || !Array.isArray(tags)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid input: "tags" must be an array.' 
      });
    }

    console.log(`[ChatRoutes] Updating interests for userId: ${userId}`, tags);

    // Update the user's interests in the database
    // Note: Ensure userService has an updateUserInterests(userId, tags) method
    await userService.updateUserInterests(userId, tags);

    // Send a success response back to the client
    res.status(200).json({
      success: true,
      message: 'Interests updated successfully.'
    });

  } catch (error) {
    console.error('Error in /update-interests:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// GET /user-interests/:userId
// Retrieves the user's interests array from the database
router.get('/user-interests/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[ChatRoutes] GET /user-interests/${userId}`);
    const interests = await userService.getUserInterests(userId);
    res.json({ success: true, interests: interests || [] });
  } catch (error) {
    console.error('Error in /user-interests/:userId:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});
// Uses Gemini to suggest a conversation starter based on user interests
router.get('/suggest-topic/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[ChatRoutes] Received topic suggestion request for ${userId}`);
    const prompt = await geminiService.generateConversationStarter(userId);
    res.json({ success: true, prompt });
  } catch (error) {
    console.error('Error in /suggest-topic:', error);
    res.status(500).json({ success: false, message: 'Failed to generate suggestion' });
  }
});

module.exports = { router, queue };