const { v4: uuidv4 } = require('uuid');
const friendService = require('./friendService');

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
        const { supabase } = require('../config/supabase');
        const { data: friends } = await supabase
          .from('friends')
          .select('friend_id')
          .eq('user_id', userId);
          
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
      const userInQueue = queue.some(user => user.id === userId);
      const currentSocketId = this.userSocketMap.get(userId);
      
      if (!userInQueue || currentSocketId !== socket.id) {
        socket.emit('queue-heartbeat-response', { inQueue: false });
      } else {
        socket.emit('queue-heartbeat-response', { inQueue: true });
      }
    });

    // Atomic skip partner
    socket.on('skip-partner', async ({ chatId, userId }) => {
      socket.leave(chatId);
      io.to(chatId).emit('partner-disconnected');
      
      const result = await this.joinQueue(userId, socket.id, queue);
      socket.emit('queue-joined', result);
    });

    socket.on('join-chat', ({ chatId }) => {
      socket.join(chatId);
    });

    socket.on('send-message', async ({ chatId, message, userId, username, replyTo }) => {
      if (chatId.startsWith('friend_')) {
        try {
          const [, userA, userB] = chatId.split('_');
          const receiverId = userA === userId ? userB : userA;
          
          const { supabase } = require('../config/supabase');
          await supabase
            .from('friend_messages')
            .insert({
              chat_id: chatId,
              sender_id: userId,
              receiver_id: receiverId,
              message: message
            });
        } catch (error) {
          console.error('Error storing friend message:', error);
        }
      }
      
      const messageData = {
        id: Date.now(),
        chatId,
        message,
        userId,
        username,
        timestamp: new Date().toISOString(),
        replyTo: replyTo || null,
        reactions: {}
      };
      io.to(chatId).emit('new-message', messageData);
    });

    socket.on('add-reaction', ({ chatId, messageId, emoji, userId }) => {
      io.to(chatId).emit('message-reaction', { messageId, emoji, userId });
    });

    socket.on('leave-chat', ({ chatId, userId }) => {
      const chatData = this.activeChats.get(chatId);
      if (chatData) {
        const partner = chatData.users.find(u => u.id !== userId);
        if (partner) {
          const partnerSocket = this.userSockets.get(partner.id);
          if (partnerSocket && partnerSocket.connected) {
            partnerSocket.emit('partner-disconnected');
            if (!queue.find(u => u.id === partner.id)) {
              queue.push(partner);
            }
          }
        }
        this.activeChats.delete(chatId);
      }
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        this.userSessions.delete(socket.userId);
        this.userSocketMap.delete(socket.userId);
      }
      
      for (const [userId, sock] of this.userSockets.entries()) {
        if (sock === socket) {
          for (const [chatId, chatData] of this.activeChats.entries()) {
            const userInChat = chatData.users.find(u => u.id === userId);
            if (userInChat) {
              const partner = chatData.users.find(u => u.id !== userId);
              if (partner) {
                const partnerSocket = this.userSockets.get(partner.id);
                if (partnerSocket && partnerSocket.connected) {
                  partnerSocket.emit('partner-disconnected');
                }
              }
              this.activeChats.delete(chatId);
              break;
            }
          }
          
          this.userSockets.delete(userId);
          const index = queue.findIndex(u => u.id === userId);
          if (index !== -1) queue.splice(index, 1);
          console.log(`User disconnected and removed: ${userId}`);
          break;
        }
      }
    });
  }

  async joinQueue(userId, socketId, queue) {
    const existingIndex = queue.findIndex(user => user.id === userId);
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1);
    }
    
    this.userSocketMap.set(userId, socketId);
    queue.push({ id: userId, socketId, timestamp: Date.now() });
    
    return {
      queuePosition: queue.length,
      success: true
    };
  }

  async tryMatchUsers(queue) {
    while (queue.length >= 2) {
      const user1 = queue[0];
      const user2 = queue[1];
      const socket1 = this.userSockets.get(user1.id);
      const socket2 = this.userSockets.get(user2.id);

      if (!socket1?.connected || !socket2?.connected) {
        if (!socket1?.connected) queue.shift();
        if (queue.length > 1 && !socket2?.connected) queue.splice(1, 1);
        continue;
      }

      // Check if users have blocked each other
      try {
        const isBlocked = await friendService.isBlocked(user1.id, user2.id);
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