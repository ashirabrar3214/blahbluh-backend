const express = require('express');
const friendService = require('../services/friendService');
const supabase = require('../config/supabase');
const router = express.Router();

router.post('/friend-request', async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;
    console.log(`[FRIEND] Request from ${fromUserId} to ${toUserId}`);
    const result = await friendService.sendFriendRequest(fromUserId, toUserId);
    res.json(result);
  } catch (error) {
    console.error('❌ Friend request route error:', error);
    res.json({ success: false, message: 'Service unavailable' });
  }
});

router.post('/accept-friend', async (req, res) => {
  try {
    const { requestId, userId } = req.body;
    console.log(`[FRIEND] Accept request ${requestId} by user ${userId}`);
    const acceptedRequest = await friendService.acceptFriendRequest(requestId, userId);
    
    if (acceptedRequest && acceptedRequest.from_user_id) {
      const senderSocketId = global.connectedUsers?.get(acceptedRequest.from_user_id);
      if (senderSocketId && global.io) {
        global.io.to(senderSocketId).emit('friend-request-accepted', {
          userId: userId,
          message: 'Your friend request was accepted!'
        });
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Accept friend error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/friend-requests/:userId', async (req, res) => {
  try {
    const requests = await friendService.getFriendRequests(req.params.userId);
    res.json(requests);
  } catch (error) {
    console.error('❌ Friend requests error:', error);
    res.json([]);
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
  try {
    const chats = await friendService.getFriendChats(req.params.userId);
    res.json(chats);
  } catch (error) {
    console.error('❌ Friend chats error:', error);
    res.json([]);
  }
});

router.get('/friend-chat-messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const { data: messages, error } = await supabase
      .from('friend_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(50);
      
    if (error) throw error;
    res.json(messages || []);
  } catch (error) {
    console.error('❌ Chat messages error:', error);
    res.json([]);
  }
});

// Get unread message count
router.get('/unread-count/:userId/:friendId', async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    const chatId = `friend_${[userId, friendId].sort().join('_')}`;
    
    const { count, error } = await supabase
      .from('friend_messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .eq('receiver_id', userId)
      .is('read_at', null);
      
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    console.error('❌ Unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Mark messages as read
router.post('/mark-read', async (req, res) => {
  try {
    const { userId, friendId } = req.body;
    const chatId = `friend_${[userId, friendId].sort().join('_')}`;
    
    const { error } = await supabase
      .from('friend_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('chat_id', chatId)
      .eq('receiver_id', userId)
      .is('read_at', null);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

module.exports = router;