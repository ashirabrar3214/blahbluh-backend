const { v4: uuidv4 } = require('uuid');

class SocketService {
  constructor() {
    this.userSockets = new Map();
    this.activeChats = new Map();
  }

  handleConnection(io, socket, queue) {
    socket.on('register-user', ({ userId }) => {
      this.userSockets.set(userId, socket);
      console.log(`User registered: ${userId} -> ${socket.id}`);
      socket.emit('registration-confirmed', { userId });
    });

    socket.on('join-chat', ({ chatId }) => {
      socket.join(chatId);
    });

    socket.on('send-message', ({ chatId, message, userId, username, replyTo }) => {
      const messageData = {
        id: uuidv4(),
        chatId,
        message,
        userId,
        username,
        timestamp: Date.now(),
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

  tryMatchUsers(queue) {
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

      queue.splice(0, 2);
      const chatId = uuidv4();
      this.activeChats.set(chatId, { users: [user1, user2], messages: [] });

      socket1.emit('chat-paired', { chatId, users: [user1, user2] });
      socket2.emit('chat-paired', { chatId, users: [user1, user2] });
    }
  }
}

module.exports = new SocketService();