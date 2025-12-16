const express = require('express');
const friendService = require('../services/friendService');
const supabase = require('../config/supabase');
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
  console.log('✅ Accepting friend request:', req.body);
  try {
    const { requestId, userId } = req.body;
    const acceptedRequest = await friendService.acceptFriendRequest(requestId, userId);
    
    // Get the original sender's info for notification
    if (acceptedRequest && acceptedRequest.from_user_id) {
      const senderSocketId = global.connectedUsers?.get(acceptedRequest.from_user_id);
      if (senderSocketId && global.io) {
        console.log('🔔 Sending friend request accepted notification to:', acceptedRequest.from_user_id);
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