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
      // Find and notify partner before leaving
      const chatData = this.activeChats.get(chatId);
      if (chatData) {
        const partner = chatData.users.find(u => u.userId !== userId);
        if (partner) {
          const partnerSocket = this.userSockets.get(partner.userId);
          if (partnerSocket && partnerSocket.connected) {
            partnerSocket.emit('partner-disconnected');
          }
        }
        this.activeChats.delete(chatId);
      }
      
      socket.leave(chatId);
      
      try {
        const result = await this.joinQueue(userId, socket.id, queue);
        socket.emit('queue-joined', result);
      } catch (error) {
        console.error('Error re-joining queue:', error);
      }
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

    socket.on('leave-chat', ({ chatId, userId }) => {
      const chatData = this.activeChats.get(chatId);
      if (chatData) {
        const partner = chatData.users.find(u => u.userId !== userId);
        if (partner) {
          const partnerSocket = this.userSockets.get(partner.userId);
          if (partnerSocket && partnerSocket.connected) {
            partnerSocket.emit('partner-disconnected');
            if (!queue.find(u => u.userId === partner.userId)) {
              queue.push(partner);
            }
          }
        }
        this.activeChats.delete(chatId);
      }
    });

    socket.on('disconnect', () => {
      // 1. Remove from userSockets/Sessions
      if (socket.userId) {
        this.userSessions.delete(socket.userId);
        this.userSocketMap.delete(socket.userId);
        this.userSockets.delete(socket.userId);
      }

      // 2. Find and clean up active chats
      for (const [chatId, chatData] of this.activeChats.entries()) {
        const userInChat = chatData.users.find(u => u.userId === socket.userId);
        
        if (userInChat) {
          const partner = chatData.users.find(u => u.userId !== socket.userId);
          
          if (partner) {
            const partnerSocket = this.userSockets.get(partner.userId);
            if (partnerSocket && partnerSocket.connected) {
              // Notify partner and auto-requeue them
              partnerSocket.emit('partner-disconnected');
              
              // Auto-requeue the partner for random chats only
              if (!chatId.startsWith('friend_')) {
                const existingIndex = queue.findIndex(u => u.userId === partner.userId);
                if (existingIndex === -1) {
                  queue.push({ userId: partner.userId, socketId: partnerSocket.id, timestamp: Date.now() });
                  console.log(`🔄 Auto-requeued partner ${partner.userId} after disconnect`);
                }
              }
            }
          }
          this.activeChats.delete(chatId);
          break; 
        }
      }

      // 3. Remove from queue if they were waiting
      const index = queue.findIndex(u => u.userId === socket.userId);
      if (index !== -1) {
        queue.splice(index, 1);
      }
      
      console.log(`User disconnected: ${socket.userId}`);
    });
  }

  async joinQueue(userId, socketId, queue) {
    const existingIndex = queue.findIndex(user => user.userId === userId);
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1);
    }
    
    this.userSocketMap.set(userId, socketId);
    queue.push({ userId: userId, socketId, timestamp: Date.now() });
    
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