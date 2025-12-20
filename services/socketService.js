const { v4: uuidv4 } = require('uuid');
const friendService = require('./friendService');
const supabase = require('../config/supabase');

class SocketService {
  constructor() {
    this.userSockets = new Map();
    this.activeChats = new Map();
    this.userSessions = new Map(); // userId -> socketId
    this.userSocketMap = new Map(); // userId -> socketId for queue
  }

  handleConnection(io, socket, queue) {
    socket.on('register-user', ({ userId }) => {
      this.userSockets.set(userId, socket);
      this.userSessions.set(userId, socket.id);
      socket.userId = userId;
      console.log(`User registered: ${userId} -> ${socket.id}`);
      socket.emit('registration-confirmed', { userId });
    });

    // Fetch unread messages on connect
    socket.on('fetch-unread-messages', async ({ userId }) => {
      try {
        const { data: friends, error } = await supabase
          .from('friends')
          .select('friend_id')
          .eq('user_id', userId);
          
        if (error) throw error;
        
        friends?.forEach(friend => {
          const chatId = `friend_${[userId, friend.friend_id].sort().join('_')}`;
          socket.join(chatId);
        });
      } catch (error) {
        console.error('Error fetching unread messages:', error);
      }
    });

    // Queue heartbeat
    socket.on('queue-heartbeat', ({ userId }) => {
      const userInQueue = queue.some(user => user.userId === userId);
      socket.emit('queue-heartbeat-response', { inQueue: userInQueue });
    });

    // Atomic skip partner
    socket.on('skip-partner', async ({ chatId, userId }) => {
      const chatData = this.activeChats.get(chatId);
      socket.leave(chatId);

      const getId = (u) => u?.userId ?? u?.id;

      if (chatData) {
        const me = chatData.users.find(u => getId(u) === userId);
        const partner = chatData.users.find(u => getId(u) !== userId);
        const partnerId = getId(partner);

        // notify partner + boot them from the room
        if (partnerId) {
          const partnerSocket = this.userSockets.get(partnerId);
          if (partnerSocket?.connected) {
            partnerSocket.emit('partner-disconnected', { chatId });
            io.to(chatId).emit('partner-disconnected', { chatId });
            partnerSocket.leave(chatId);

          }

          await this.joinQueue(partnerId, partnerSocket.id, queue);
          await this.joinQueue(userId, socket.id, queue);

          this.activeChats.delete(chatId);
        }
      } else {
        // fallback: at least requeue me
        if (!queue.some(u => (u.userId ?? u.id) === userId)) {
          await this.joinQueue(userId, socket.id, queue);
        }
      }

      const position = queue.findIndex(u => u.userId === userId) + 1;
      socket.emit('queue-joined', { success: true, queuePosition: position });
  });


    socket.on('join-chat', ({ chatId }) => {
      socket.join(chatId);
    });

    socket.on('send-message', async (data) => {
      try {
        const { chatId, message, userId, username, replyTo } = data;
        
        // Store friend messages in database
        if (chatId.startsWith('friend_')) {
          const [, userA, userB] = chatId.split('_');
          const receiverId = userA === userId ? userB : userA;
          
          const { data: savedMessage, error } = await supabase
            .from('friend_messages')
            .insert({
              chat_id: chatId,
              sender_id: userId,
              receiver_id: receiverId,
              message: message
            })
            .select()
            .single();
            
          if (error) throw error;
          
          // Create message data with database ID
          const messageData = {
            id: savedMessage.id,
            chatId,
            message,
            userId,
            username,
            timestamp: savedMessage.created_at,
            replyTo
          };
          
          // Send to chat room AND emit special friend message event
          io.to(chatId).emit('new-message', messageData);
          io.to(chatId).emit('friend-message-received', messageData);
        } else {
          // Regular random chat message
          const messageData = {
            id: Date.now(),
            chatId,
            message,
            userId,
            username,
            timestamp: new Date().toISOString(),
            replyTo
          };
          
          io.to(chatId).emit('new-message', messageData);
        }
      } catch (error) {
        console.error('Error storing friend message:', error);
      }
    });

    socket.on('add-reaction', ({ chatId, messageId, emoji, userId }) => {
      io.to(chatId).emit('message-reaction', { messageId, emoji, userId });
    });

    socket.on('leave-chat', async ({ chatId, userId }) => {
  const chatData = this.activeChats.get(chatId);
  if (!chatData) return;

  const getId = (u) => u?.userId ?? u?.id;

  const partner = chatData.users.find(u => getId(u) !== userId);
  const partnerId = getId(partner);

  // notify + requeue partner
  if (partnerId) {
    const partnerSocket = this.userSockets.get(partnerId);
    if (partnerSocket?.connected) {
      partnerSocket.emit('partner-disconnected', { chatId });
      io.to(chatId).emit('partner-disconnected', { chatId });
      partnerSocket.leave(chatId);

      try {
        const result = await this.joinQueue(partnerId, partnerSocket.id, queue);
        partnerSocket.emit('queue-joined', result);
      } catch (e) {
        console.error('Error re-joining partner to queue:', e);
      }
    }
  }

  socket.leave(chatId);
  this.activeChats.delete(chatId);
});

socket.on('disconnect', async () => {
  const leavingId = socket.userId;
  if (!leavingId) return;

  this.userSessions.delete(leavingId);
  this.userSocketMap.delete(leavingId);

  // remove from queue if present
  const qIndex = queue.findIndex(u => u.userId === leavingId);
  if (qIndex !== -1) queue.splice(qIndex, 1);

  const getId = (u) => u?.userId ?? u?.id;

  // if they were in an active chat, notify + requeue partner
  for (const [chatId, chatData] of this.activeChats.entries()) {
    const inChat = chatData.users.some(u => getId(u) === leavingId);
    if (!inChat) continue;

    const partner = chatData.users.find(u => getId(u) !== leavingId);
    const partnerId = getId(partner);

    if (partnerId) {
      const partnerSocket = this.userSockets.get(partnerId);
      if (partnerSocket?.connected) {
        partnerSocket.emit('partner-disconnected', { chatId });
        io.to(chatId).emit('partner-disconnected', { chatId });
        partnerSocket.leave(chatId);

        try {
          const result = await this.joinQueue(partnerId, partnerSocket.id, queue);
          partnerSocket.emit('queue-joined', result);
        } catch (e) {
          console.error('Error re-joining partner to queue:', e);
        }
      }
    }

    this.activeChats.delete(chatId);
    break;
  }

  // finally remove socket mapping
  for (const [userId, sock] of this.userSockets.entries()) {
    if (sock === socket) {
      this.userSockets.delete(userId);
      break;
    }
  }

  console.log(`User disconnected and removed: ${leavingId}`);
});


  }

  async joinQueue(userId, socketId, queue) {
    // Remove existing entry
    const existingIndex = queue.findIndex(u => u.userId === userId);
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1);
    }

    // 🔥 ALWAYS hydrate from DB
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username')
      .eq('id', userId)
      .single();

    if (error || !user) {
      console.error('joinQueue: failed to hydrate user', userId);
      return { success: false };
    }

    this.userSocketMap.set(userId, socketId);

    queue.push({
      userId: user.id,
      username: user.username
    });

    return {
      queuePosition: queue.length,
      success: true
    };
  }

  async tryMatchUsers(queue) {
    while (queue.length >= 2) {
      const user1 = queue[0];
      const user2 = queue[1];
      const socket1 = this.userSockets.get(user1.userId);
      const socket2 = this.userSockets.get(user2.userId);

      if (!socket1?.connected || !socket2?.connected) {
        if (!socket1?.connected) queue.shift();
        if (queue.length > 1 && !socket2?.connected) queue.splice(1, 1);
        continue;
      }

      // Check if users have blocked each other
      try {
        const isBlocked = await friendService.isBlocked(user1.userId, user2.userId);
        if (isBlocked) {
          // Skip this pairing, remove user2 and try again
          queue.splice(1, 1);
          continue;
        }
      } catch (error) {
        console.error('Error checking blocked users:', error);
      }

      queue.splice(0, 2);
      const chatId = uuidv4();
      this.activeChats.set(chatId, { users: [user1, user2], messages: [] });

      socket1.emit('chat-paired', { chatId, users: [user1, user2] });
      socket2.emit('chat-paired', { chatId, users: [user1, user2] });
    }
  }
}

module.exports = new SocketService();