const express = require('express');
const friendService = require('../services/friendService');
const router = express.Router();

router.post('/friend-request', async (req, res) => {
  console.log('🔵 Friend request received:', req.body);
  try {
    const { fromUserId, toUserId } = req.body;
    console.log('📤 Sending friend request from:', fromUserId, 'to:', toUserId);
    
    const result = await friendService.sendFriendRequest(fromUserId, toUserId);
    console.log('✅ Friend request result:', result);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Friend request route error:', error);
    res.json({ success: false, message: 'Service unavailable' });
  }
});

router.post('/accept-friend', async (req, res) => {
  try {
    const { requestId, userId } = req.body;
    await friendService.acceptFriendRequest(requestId, userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/friend-requests/:userId', async (req, res) => {
  console.log('📜 Getting friend requests for user:', req.params.userId);
  try {
    const requests = await friendService.getFriendRequests(req.params.userId);
    console.log('📊 Friend requests found:', requests.length, 'requests');
    res.json(requests);
  } catch (error) {
    console.error('❌ Friend requests error:', error);
    res.json([]); // Return empty array instead of 500 error
  }
});

router.get('/friends/:userId', async (req, res) => {
  try {
    const friends = await friendService.getFriends(req.params.userId);
    res.json(friends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/block', async (req, res) => {
  try {
    const { userId, blockedUserId } = req.body;
    await friendService.blockUser(userId, blockedUserId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Friend chat endpoints
router.get('/friend-chats/:userId', async (req, res) => {
  console.log('📱 Getting friend chats for user:', req.params.userId);
  try {
    const chats = await friendService.getFriendChats(req.params.userId);
    console.log('💬 Friend chats found:', chats.length);
    res.json(chats);
  } catch (error) {
    console.error('❌ Friend chats error:', error);
    res.json([]);
  }
});

router.get('/friend-chat-messages/:chatId', async (req, res) => {
  console.log('📨 Getting messages for chat:', req.params.chatId);
  try {
    const messages = await friendService.getChatMessages(req.params.chatId);
    res.json(messages);
  } catch (error) {
    console.error('❌ Chat messages error:', error);
    res.json([]);
  }
});

module.exports = router;