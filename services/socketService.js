const { v4: uuidv4 } = require('uuid');
const friendService = require('./friendService');
const userService = require('./userService');
const supabase = require('../config/supabase');
const adminService = require('./adminService');
const moderationService = require('./moderationService');
const { validateClipUrl } = require('./linkValidator');

class SocketService {
  constructor() {
    this.userSockets = new Map();
    this.activeChats = new Map();
    this.userSessions = new Map(); // userId -> socketId
    this.userSocketMap = new Map(); // userId -> socketId for queue
    this.queueReference = [];
    this.disconnectTimers = new Map(); // userId -> { timerId, chatId }
    
    // ✅ NEW: Cache for blocked users (UserId -> Set of Blocked UserIds)
    this.blockedCache = new Map(); 

    this.io = null;
    this.statsInterval = null;
    this.isMatching = false; // (Recommended from previous advice)

    // ✅ 1. Start the Janitor immediately
    this.startQueueJanitor();
  }

  handleConnection(io, socket, queue) {
    this.queueReference = queue;
    if (!this.io) {
      this.io = io;
      this.startStatsInterval();
    }

    // Helper to check limits
    const checkMatchLimit = async (userId, socket) => {
      const user = await userService.getUser(userId); // Use userService to handle daily resets
      
      // If user has 0 matches (and is not infinite -1)
      if (user && user.matches_remaining === 0) {
        socket.emit('match-error', { 
          code: user.is_guest ? 'GUEST_LIMIT' : 'DAILY_LIMIT', 
          error: 'Out of matches' 
        });
        return false; // ❌ Blocked
      }
      return true; // ✅ Allowed
    };

    // console.log(`[SocketService] New connection handling started: ${socket.id}`);
    // 1. REGISTER USER (Handle Reconnections)
    socket.on('register-user', async ({ userId }) => {
      if (!userId) return;

      // ✅ GRACE PERIOD RECOVERY
      if (this.disconnectTimers.has(userId)) {
        // console.log(`[SocketService] User ${userId} recovered session!`);
        clearTimeout(this.disconnectTimers.get(userId));
        this.disconnectTimers.delete(userId);

        // Update socket mappings
        this.userSockets.set(userId, socket);
        this.userSessions.set(userId, socket.id);
        socket.userId = userId;

        // Restore to Active Chat
        for (const [chatId, chatData] of this.activeChats.entries()) {
          const getId = (u) => u?.userId ?? u?.id;
          if (chatData.users.some(u => getId(u) === userId)) {
            socket.join(chatId); // Re-join socket room
            
            // 1. Tell PARTNER: "They are back!"
            socket.to(chatId).emit('partner-status', { status: 'online' });

            // 2. Tell USER: "You are still in this chat! Go back!"
            // We re-send the pairing data so the frontend knows to mount ChatPage
            socket.emit('chat-paired', {
              chatId,
              users: chatData.users,
              restored: true // Flag to help frontend logic
            });
            
            // console.log(`[SocketService] Restored ${userId} to chat ${chatId}`);
            break; 
          }
        }

        socket.emit('registration-confirmed', { userId });
        
        // Update DB timestamp
        await supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', userId);
        return; // Stop here
      }

      // ... [Keep your existing standard registration logic here] ...
      // (The part where you kill old sockets and purge queues)
      const oldSocketId = this.userSessions.get(userId);
      if (oldSocketId && oldSocketId !== socket.id) {
        await this._purgeUserFromQueueAndChat(userId, queue, io);
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      } else {
        await this._purgeUserFromQueueAndChat(userId, queue, io);
      }
      this.userSockets.set(userId, socket);
      this.userSessions.set(userId, socket.id);
      socket.userId = userId;
      await supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', userId);
      socket.emit('registration-confirmed', { userId });
    });

    // ✅ NEW: Handle Explicit Page Refresh/Close
    socket.on('page-unload', () => {
      // Mark this socket as "Killing itself intentionally"
      socket.isRefreshing = true;
      console.log(`[SocketService] User ${socket.userId} is refreshing/leaving. Skipping grace period.`);
    });

    socket.on('join-queue', async (data) => {
      try {
        const { userId, tags } = data;

        // 1. CHECK IF BANNED
        const banStatus = await moderationService.isUserBanned(userId);
        if (banStatus.banned) {
          // Emit a specific error event to the client
          socket.emit('banned', { 
            reason: banStatus.reason, 
            bannedUntil: banStatus.banned_until 
          });
          return; // Stop here, do not add to queue
        }

        // 2. ✅ UNIVERSAL MATCH CHECK
        const allowed = await checkMatchLimit(userId, socket);
        if (!allowed) return; // Stop here. Do not add to queue.

        // console.log(`User ${userId} joined queue with tags: ${tags}`);
        const result = await this.joinQueue(userId, socket.id, queue);
        socket.emit('queue-joined', result);
        this.tryMatchUsers(queue);
      } catch (error) {
        console.error('Join queue error:', error);
      }
    });

    // Fetch unread messages on connect
    socket.on('fetch-unread-messages', async ({ userId }) => {
      // console.log(`[SocketService] 'fetch-unread-messages' for ${userId}`);
      try {
        const { data: friends, error } = await supabase
          .from('friends')
          .select('friend_id')
          .eq('user_id', userId);
          
        if (error) throw error;
        
        // console.log(`[SocketService] Found ${friends?.length || 0} friends for unread check`);
        
        friends?.forEach(friend => {
          const chatId = `friend_${[userId, friend.friend_id].sort().join('_')}`;
          socket.join(chatId);
          // console.log(`[SocketService] User ${userId} joined friend chat room: ${chatId}`);
        });
      } catch (error) {
        console.error('Error fetching unread messages:', error);
      }
    });

    // Queue heartbeat
    socket.on('queue-heartbeat', ({ userId }) => {
      // // console.log(`[SocketService] 'queue-heartbeat' for ${userId}`); 
      const userInQueue = queue.some(user => user.userId === userId);
      socket.emit('queue-heartbeat-response', { inQueue: userInQueue });
    });

    // ✅ NEW: Handle status check from client waking up
    socket.on('check-active-chat', ({ chatId, userId }) => {
      // 1. If it's a Friend Chat, ignore (they are always active)
      if (chatId.startsWith('friend_')) return;

      // 2. Check if the Random Chat still exists in server memory
      const chatData = this.activeChats.get(chatId);
      const isActive = chatData && chatData.users.some(u => (u.userId || u.id) === userId);

      if (!isActive) {
        // console.log(`[SocketService] User ${userId} checked dead chat ${chatId}. Force disconnecting.`);
        
        // 3. Trigger the EXISTING 'partner-disconnected' event on the client.
        // This reuses your App.js logic to force the user back to Home.
        socket.emit('partner-disconnected', {
          chatId,
          reason: 'timeout',
          shouldRequeue: false // Don't put them in queue, just kick to home
        });
      } else {
        // 4. If chat IS active, ensure this user is actually in the socket room
        // (Fixes case where they reconnected but register-user didn't join them yet)
        socket.join(chatId);
      }
    });

    // Atomic skip partner (robust + no double-skip fallout)
    socket.on('skip-partner', async ({ chatId, userId, reason }) => {
      // console.log(`[SocketService] 'skip-partner' received. User: ${userId}, Chat: ${chatId}, Reason: ${reason}`);
      const getId = (u) => u?.userId ?? u?.id;

      // console.log(`[skip-partner] user=${userId} chatId=${chatId} reason=${reason}`);

      // Remove the skipper from the room first (so they don't receive partner-disconnected)
      socket.leave(chatId);
      // console.log(`[SocketService] User ${userId} left room ${chatId} (skip)`);

      const chatData = this.activeChats.get(chatId);

      // If server already forgot the chat (double emits, stale client),
      // at least requeue the skipper safely.
      if (!chatData) {
        // console.log(`[SocketService] Chat data not found for ${chatId}. Handling stale client.`);
        if (reason !== 'exit') {
          // console.log(`[SocketService] Requeueing user ${userId} (stale chat)`);
          const allowed = await checkMatchLimit(userId, socket);
          if (allowed) {
            const myRes = await this.joinQueue(userId, socket.id, queue);
            socket.emit('queue-joined', myRes);
          }
        }
        // console.log(`[skip-partner] chatData missing for chatId=${chatId} (stale client)`);
        return;
      }

      const partner = chatData.users.find(u => getId(u) !== userId);
      const partnerId = getId(partner);
      // console.log(`[SocketService] Identified partner: ${partnerId}`);

      // ✅ REFUND THE PARTNER
      // "userId" is the Skipper (Clicked Next). They pay.
      // "partnerId" is the Victim (Got Skipped). They get a refund.
      if (partnerId) {
         this.refundMatch(partnerId);
      }

      const shouldRequeuePartner = reason !== 'exit';

      // Tell whoever is still in the room (partner) that chat ended.
      // console.log(`[SocketService] Notifying room ${chatId} of partner disconnect`);
      io.to(chatId).emit('partner-disconnected', {
        chatId,
        reason: reason || 'skip',
        shouldRequeue: shouldRequeuePartner,
        byUserId: userId
      });

      // Try direct partner socket too (in case they never joined the room)
      const partnerSocket = partnerId ? this.userSockets.get(partnerId) : null;
      if (partnerSocket?.connected) {
        // console.log(`[SocketService] Sending direct disconnect to partner socket ${partnerSocket.id}`);
        partnerSocket.emit('partner-disconnected', {
          chatId,
          reason: reason || 'skip',
          shouldRequeue: shouldRequeuePartner,
          byUserId: userId
        });
        partnerSocket.leave(chatId);
        // console.log(`[SocketService] Partner ${partnerId} left room ${chatId}`);

        // If we should requeue the partner, WE MUST DO IT HERE manually
        if (shouldRequeuePartner) {
          // console.log(`[SocketService] Auto-requeueing partner ${partnerId} after skip`);
          
          // Add partner to queue
          const partnerRes = await this.joinQueue(partnerId, partnerSocket.id, queue);
          
          // Tell partner they are queued (so their UI can switch to "Searching...")
          partnerSocket.emit('queue-joined', partnerRes);
        }
      }

      // Requeue skipper unless they explicitly exited (Home)
      if (reason !== 'exit') {
        // C) ✅ CHECK MATCH LIMIT ON SKIP
        const allowed = await checkMatchLimit(userId, socket);
        
        if (allowed) {
           // ✅ Allow requeue
           const myRes = await this.joinQueue(userId, socket.id, queue);
           socket.emit('queue-joined', myRes);
        }
      }

      this.activeChats.delete(chatId);
      // console.log(`[skip-partner] chat deleted chatId=${chatId}`);
    });

    socket.on('join-chat', ({ chatId }) => {
      // console.log(`[SocketService] 'join-chat' received for ${chatId} from ${socket.id}`);
      socket.join(chatId);
    });

    socket.on('send-message', async (data) => {
      // console.log(`[SocketService] 'send-message' received for chat: ${data.chatId}`);
      
      // 1. SAFETY CHECK: Stop crash if chatId is missing
      if (!data.chatId) {
        console.error('[SocketService] ERROR: Message missing chatId', data);
        socket.emit('message-error', { 
          id: data.id, 
          error: 'Chat ID missing. Please refresh.' 
        });
        return;
      }

      try {
        // 2. VALIDATE CLIPS
        if (data.type === 'clip') {
          // Ensure linkValidator is imported at the top of file!
          // const { validateClipUrl } = require('../services/linkValidator'); 
          const validation = await validateClipUrl(data.message);

          if (!validation.valid) {
            socket.emit('message-error', {
              id: data.id,
              error: validation.error
            });
            return;
          }
          data.message = validation.cleanUrl;
        }

        const { chatId, message } = data;
        const userId = socket.userId; // Trusted ID attached during register-user
        data.userId = userId; // Ensure emitted message uses the trusted ID
        
        // 3. STORE & BROADCAST
        if (chatId.startsWith('friend_')) {
          // ... your existing friend logic ...
          // console.log(`[SocketService] Friend message processing: ${chatId}`);
          
          // Database Insert Logic
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
          
          const messageData = {
            ...data,
            id: savedMessage.id,
            timestamp: savedMessage.created_at,
          };
          
          io.to(chatId).emit('new-message', messageData);
          // io.to(chatId).emit('friend-message-received', messageData);
        } else {
          // ... your existing random chat logic ...
          // console.log(`[SocketService] Random message processing: ${chatId}`);
          const messageData = {
            ...data,
            id: Date.now(),
            timestamp: new Date().toISOString(),
          };
          io.to(chatId).emit('new-message', messageData);
        }
      } catch (error) {
        console.error('Error storing/sending message:', error);
        socket.emit('message-error', {
          chatId: data.chatId,
          error: 'Failed to send message. Please try again.'
        });
      }
    });

    socket.on('add-reaction', ({ chatId, messageId, emoji, userId }) => {
      // console.log(`[SocketService] 'add-reaction' ${emoji} to msg ${messageId} in ${chatId}`);
      io.to(chatId).emit('message-reaction', { messageId, emoji, userId });
    });

    // --- WebRTC Voice/Video Signaling ---
    // This architecture uses the existing Socket.IO connection as a Signaling Server for WebRTC.
    // The actual audio/video data flows Peer-to-Peer (P2P), ensuring low latency and scalability.

    // 1. Offer: Initiator sends an offer to the peer in the specific chat
    socket.on('call-offer', ({ chatId, offer, fromUserId, isVideo = false }) => {
      const resolvedFromUserId = socket.userId || fromUserId; // ✅ fallback
      // console.log(`[SocketService] 'call-offer' from ${resolvedFromUserId} in chat ${chatId}`);

      socket.to(chatId).emit('call-offer', {
        chatId,
        offer,
        fromUserId: resolvedFromUserId,
        isVideo
      });
    });

    // 2. Answer: Peer accepts and sends an answer back
    socket.on('call-answer', ({ chatId, answer }) => {
      // console.log(`[SocketService] 'call-answer' from ${socket.userId} in chat ${chatId}`);
      socket.to(chatId).emit('call-answer', {
        chatId,
        answer,
        fromUserId: socket.userId
      });
    });

    // 3. ICE Candidate: Exchanging network paths to punch through NATs
    socket.on('ice-candidate', ({ chatId, candidate }) => {
      // // console.log(`[SocketService] 'ice-candidate' from ${socket.userId}`);
      socket.to(chatId).emit('ice-candidate', {
        chatId,
        candidate,
        fromUserId: socket.userId
      });
    });

    // 4. Hangup/Reject: Signaling termination
    socket.on('call-hangup', ({ chatId }) => {
      // console.log(`[SocketService] 'call-hangup' from ${socket.userId} in chat ${chatId}`);
      socket.to(chatId).emit('call-hangup', {
        chatId,
        byUserId: socket.userId
      });
    });

    socket.on('leave-chat', async ({ chatId, userId, reason, requeuePartner = false })=> {
      // console.log(`[SocketService] 'leave-chat' received. User: ${userId}, Chat: ${chatId}, Reason: ${reason}, RequeuePartner: ${requeuePartner}`);
      const chatData = this.activeChats.get(chatId);
      if (!chatData) {
        // console.log(`[SocketService] Chat data not found for ${chatId} during leave-chat`);
        return;
      }

      const getId = (u) => u?.userId ?? u?.id;
      const partner = chatData.users.find(u => getId(u) !== userId);
      const partnerId = getId(partner);

      // ✅ Always remove the leaver from queue if they are in it
      const meIdx = queue.findIndex(u => u.userId === userId);
      if (meIdx !== -1) {
        queue.splice(meIdx, 1);
        // console.log(`[SocketService] Removed user ${userId} from queue during leave-chat`);
      }

      // Notify partner that chat ended
      if (partnerId) {
        const partnerSocket = this.userSockets.get(partnerId);
        if (partnerSocket?.connected) {
          // console.log(`[SocketService] Notifying partner ${partnerId} of disconnect`);
          partnerSocket.emit('partner-disconnected', {
            chatId,
            reason: reason || 'leave-chat',
            shouldRequeue: !!requeuePartner,
            byUserId: userId
          });
          partnerSocket.leave(chatId);

          // ✅ Requeue partner unless explicitly disabled
          if (requeuePartner) {
            try {
              // console.log(`[SocketService] Requeueing partner ${partnerId}`);
              const result = await this.joinQueue(partnerId, partnerSocket.id, queue);
              partnerSocket.emit('queue-joined', result);
            } catch (e) {
              console.error('Error re-joining partner to queue:', e);
            }
          }
        } else {
          // console.log(`[SocketService] Partner ${partnerId} socket not connected`);
        }
      }

      // Leave room and delete active chat
      socket.leave(chatId);
      
      if (chatData.present) {
        chatData.present.delete(userId);

        // Only delete the chat when nobody is left in it
        if (chatData.present.size === 0) {
          this.activeChats.delete(chatId);
          // console.log(`[SocketService] Chat ${chatId} deleted (everyone left)`);
        } else {
          // console.log(`[SocketService] Chat ${chatId} still active; present=${[...chatData.present].join(',')}`);
        }
      } else {
        // fallback for older chat objects
        this.activeChats.delete(chatId);
        // console.log(`[SocketService] Chat ${chatId} deleted (no presence tracking)`);
      }

      // NOTE:
      // If reason === 'exit', we intentionally do NOT requeue the leaver.
      // The frontend also calls /leave-queue for safety.
    });

    // ==========================================
    // ADMIN PANEL EVENTS
    // ==========================================

    // Helper to verify admin (basic implementation)
    // For production, you should verify a token sent with the handshake or event
    const verifyAdmin = () => {
      // TODO: Implement real admin verification here. 
      // For now, we allow it so the UI works as requested.
      return true; 
    };

    socket.on('admin-get-stats', async () => {
      if (!verifyAdmin()) return;
      // console.log(`[SocketService] Admin stats requested by ${socket.id}`);

      // Join the admin room for real-time updates
      socket.join('admins');

      // Send immediate stats
      const stats = await this.gatherStats();
      socket.emit('admin-stats', stats);
    });

    socket.on('admin-get-banned', async () => {
      if (!verifyAdmin()) return;
      const list = await adminService.getBannedUsers();
      socket.emit('admin-banned-list', list);
    });

    socket.on('admin-unban-user', async (userId) => {
      if (!verifyAdmin()) return;
      // console.log(`[SocketService] Admin unbanning user: ${userId}`);
      
      const success = await adminService.unbanUser(userId);
      
      if (success) {
        // Refresh the list for the admin
        const list = await adminService.getBannedUsers();
        socket.emit('admin-banned-list', list);
      }
    });

    socket.on('admin-search-user', async (searchTerm) => {
      if (!verifyAdmin()) return;
      
      const users = await adminService.searchUsers(searchTerm);
      
      // Map to frontend format and determine status
      const results = users.map(u => {
        let status = 'Offline';
        const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
        const isOnline = this.userSockets.has(u.id);

        if (isBanned) status = 'Banned';
        else if (isOnline) status = 'Active'; // 'Active' in UI means Online green

        return {
          id: u.id,
          username: u.username,
          avatar: u.pfp,
          status: status
        };
      });

      socket.emit('admin-search-results', results);
    });

    // 2. DISCONNECT (Modified to check flag)
    socket.on('disconnect', async () => {
      const leavingId = socket.userId;
      if (!leavingId) return;

      // 1. Always cleanup maps immediately
      this.userSessions.delete(leavingId);
      this.userSocketMap.delete(leavingId);
      this.userSockets.delete(leavingId);
      this.blockedCache.delete(leavingId);
      
      // 2. Always remove from queue immediately
      const qIndex = queue.findIndex(u => u.userId === leavingId);
      if (qIndex !== -1) queue.splice(qIndex, 1);

      // 3. Handle Active Chats
      const getId = (u) => u?.userId ?? u?.id;
      for (const [chatId, chatData] of this.activeChats.entries()) {
        if (chatData.users.some(u => getId(u) === leavingId)) {
          
          // 🛑 CHECK FLAG: If intentional refresh, SKIP TIMER
          if (socket.isRefreshing) {
             console.log(`[SocketService] Instant cleanup for ${leavingId} (Refresh)`);
             
             // Notify partner immediately
             io.to(chatId).emit('partner-disconnected', {
                chatId,
                reason: 'disconnect',
                shouldRequeue: true,
                byUserId: leavingId
             });

             // Requeue partner immediately (optional, or let them handle it)
             const partner = chatData.users.find(u => getId(u) !== leavingId);
             const partnerId = getId(partner);
             if (partnerId) {
                const s = this.userSockets.get(partnerId);
                if (s && s.connected) {
                  s.leave(chatId);
                  // Auto-requeue partner logic here if desired
                  // ...
                }
             }
             
             // Destroy chat
             this.activeChats.delete(chatId);
             return; // ✅ EXIT HERE (Do not start 10s timer)
          }

          // ... (Your Existing 10s Timer Logic for Glitches) ...
          console.log(`[SocketService] User ${leavingId} disconnected (Glitch?). Starting 10s timer.`);
          io.to(chatId).emit('partner-status', { status: 'reconnecting' });
          
          const timer = setTimeout(async () => {
            // console.log(`[SocketService] Timer expired for ${leavingId}. Killing chat.`);
            this.disconnectTimers.delete(leavingId);
            
            if (!this.activeChats.has(chatId)) return;

            // Notify partner of FINAL disconnect
            io.to(chatId).emit('partner-disconnected', {
              chatId,
              reason: 'disconnect',
              shouldRequeue: true,
              byUserId: leavingId
            });
            
            // Requeue partner logic...
            const partner = chatData.users.find(u => getId(u) !== leavingId);
            const partnerId = getId(partner);
            if (partnerId) {
               const s = this.userSockets.get(partnerId);
               if (s) {
                 s.leave(chatId);
                 try {
                   const res = await this.joinQueue(partnerId, s.id, queue);
                   s.emit('queue-joined', res);
                 } catch(e) {}
               }
            }

            this.activeChats.delete(chatId);

          }, 10000); // 10 seconds
          
          this.disconnectTimers.set(leavingId, timer);
          break;
        }
      }
    });

    // ... [Keep all other listeners: join-queue, send-message, etc.] ...
    
    // Add this new listener for UI updates
    socket.on('partner-status', (data) => {
        // Just relay it to the specific chat room
        // (This is redundant if we emit to room above, but good for explicit status updates)
    });


  }

  async _purgeUserFromQueueAndChat(userId, queue, io) {
    if (!userId) return;

    // A) Remove from queue no matter what
    const qIndex = queue.findIndex(u => u.userId === userId);
    if (qIndex !== -1) {
      queue.splice(qIndex, 1);
      // console.log(`[SocketService] Purge: removed ${userId} from queue`);
    }

    // B) If user was in an active chat, end it + requeue partner (but NOT the user)
    const getId = (u) => u?.userId ?? u?.id;

    for (const [chatId, chatData] of this.activeChats.entries()) {
      const inChat = chatData.users?.some(u => getId(u) === userId);
      if (!inChat) continue;

      // console.log(`[SocketService] Purge: ${userId} was in chat ${chatId}`);

      const partner = chatData.users.find(u => getId(u) !== userId);
      const partnerId = getId(partner);

      if (partnerId) {
        const partnerSocket = this.userSockets.get(partnerId);
        if (partnerSocket?.connected) {
          partnerSocket.emit('partner-disconnected', {
            chatId,
            reason: 'refresh',
            shouldRequeue: true,
            byUserId: userId
          });
          partnerSocket.leave(chatId);

          // requeue partner
          try {
            const res = await this.joinQueue(partnerId, partnerSocket.id, queue);
            partnerSocket.emit('queue-joined', res);
          } catch (e) {
            console.error('[SocketService] Purge: failed to requeue partner', e);
          }
        }
      }

      this.activeChats.delete(chatId);
      // console.log(`[SocketService] Purge: chat ${chatId} deleted`);
      break;
    }
  }

  async joinQueue(userId, socketId, queue) {
    // console.log(`[SocketService] joinQueue called for ${userId}`);

    // --- FIX: Removed promoteGuest call because users are now DB-native ---
    
    // Remove existing entry
    const existingIndex = queue.findIndex(u => u.userId === userId);
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1);
    }

    // ✅ NEW: Fetch Blocked Users ONCE and Cache them
    try {
      // 1. Fetch rows where I blocked others
      const { data: blocks } = await supabase
        .from('blocked_users')
        .select('blocked_user_id')
        .eq('user_id', userId);
        
      // 2. Fetch my own "blocked_users" array column (legacy support)
      const { data: userRow } = await supabase
        .from('users')
        .select('blocked_users')
        .eq('id', userId)
        .single();

      // Combine them into a fast Set
      const blockedSet = new Set();
      blocks?.forEach(b => blockedSet.add(b.blocked_user_id));
      userRow?.blocked_users?.forEach(id => blockedSet.add(id));

      this.blockedCache.set(userId, blockedSet);
    } catch (err) {
      console.error('Error caching blocks:', err);
      this.blockedCache.set(userId, new Set()); // Safe fallback
    }

    // 🔥 ALWAYS hydrate from DB
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username')
      .eq('id', userId)
      .single();

    if (error || !user) {
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

  async deductMatch(userId) {
    try {
      // 1. Get current balance
      const { data: user } = await supabase
        .from('users')
        .select('matches_remaining')
        .eq('id', userId)
        .single();

      // 2. Subtract 1 (No "seen" checks, no history checks)
      if (user && user.matches_remaining > 0) {
        await supabase
          .from('users')
          .update({ matches_remaining: user.matches_remaining - 1 })
          .eq('id', userId);
      }
    } catch (err) {
      console.error(`[SocketService] Failed to deduct match for ${userId}:`, err);
    }
  }

  async refundMatch(userId) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('matches_remaining')
        .eq('id', userId)
        .single();

      // Only refund if they are not on infinite (-1) matches
      if (user && user.matches_remaining !== -1) {
        await supabase
          .from('users')
          .update({ matches_remaining: user.matches_remaining + 1 })
          .eq('id', userId);
        // console.log(`[SocketService] Refunded match to user ${userId}`);
      }
    } catch (err) {
      console.error(`[SocketService] Failed to refund match for ${userId}:`, err);
    }
  }

  async tryMatchUsers(queue) {
    if (this.isMatching) return;
    this.isMatching = true;

    let pairsProcessed = 0;
    // 1. INCREASE BATCH SIZE: Process more users before yielding to reduce overhead
    const BATCH_SIZE = 10; 

    try {
      while (queue.length >= 2) {
        
        // 2. THROTTLE: Use setTimeout to force this to the BACK of the event loop
        if (pairsProcessed % BATCH_SIZE === 0 && pairsProcessed > 0) {
          // Wait 10ms to let the server handle HTTP requests (Logins)
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        pairsProcessed++;

        const raw1 = queue[0];
        const raw2 = queue[1];

        const id1 = raw1?.userId ?? raw1?.id;
        const id2 = raw2?.userId ?? raw2?.id;

        // console.log(`[SocketService] Attempting to match ${id1} and ${id2}`);

        // If queue contains garbage entries, drop them safely
        if (!id1) { queue.shift(); /* console.log(`[SocketService] Invalid user 1, removed`); */ continue; }
        if (!id2) { queue.splice(1, 1); /* console.log(`[SocketService] Invalid user 2, removed`); */ continue; }

        const socket1 = this.userSockets.get(id1);
        const socket2 = this.userSockets.get(id2);

        if (!socket1?.connected || !socket2?.connected) {
          // console.log(`[SocketService] One or both sockets disconnected. S1: ${socket1?.connected}, S2: ${socket2?.connected}`);
          if (!socket1?.connected) queue.shift();
          if (queue.length > 1 && !socket2?.connected) queue.splice(1, 1);
          continue;
        }

        // ✅ NEW: Instant Memory Check
        const blocks1 = this.blockedCache.get(id1);
        const blocks2 = this.blockedCache.get(id2);

        const isBlocked = (blocks1 && blocks1.has(id2)) || (blocks2 && blocks2.has(id1));

        if (isBlocked) {
          // console.log(`[SocketService] Blocked match prevented: ${id1} <-> ${id2}`);
          // Skip pairing: keep User 1, remove User 2 (try next person for User 1)
          queue.splice(1, 1); 
          continue;
        }

        // Remove them from queue now (pairing is happening)
        queue.splice(0, 2);
        // console.log(`[SocketService] Users removed from queue for pairing`);

        // 🔥 Ensure usernames exist (fixes Stranger/?)
        let u1 = { userId: id1, username: raw1?.username };
        let u2 = { userId: id2, username: raw2?.username };

        if (!u1.username || !u2.username) {
          try {
            const { data, error } = await supabase
              .from('users')
              .select('id, username')
              .in('id', [id1, id2]);

            if (!error && Array.isArray(data)) {
              const map = new Map(data.map(x => [x.id, x.username]));
              u1.username = u1.username || map.get(id1) || 'Stranger';
              u2.username = u2.username || map.get(id2) || 'Stranger';
            } else {
              u1.username = u1.username || 'Stranger';
              u2.username = u2.username || 'Stranger';
            }
          } catch (e) {
            u1.username = u1.username || 'Stranger';
            u2.username = u2.username || 'Stranger';
          }
        }

        const chatId = uuidv4();
        this.activeChats.set(chatId, { 
          users: [u1, u2], 
          messages: [],
          present: new Set([id1, id2]) 
        });

        // console.log(`[SocketService] Active chat created: ${chatId}`);

        // ✅ CRITICAL: server-side room join (do NOT rely on client join-chat)
        socket1.join(chatId);
        socket2.join(chatId);
        // console.log(`[SocketService] Forced room join: ${chatId} -> ${id1}, ${id2}`);

        // now emit paired
        socket1.emit('chat-paired', { chatId, users: [u1, u2] });
        socket2.emit('chat-paired', { chatId, users: [u1, u2] });

        // ✅ DEDUCT MATCHES NOW
        // This runs every time a pair is formed. 
        // If they match User A 3 times, this runs 3 times.
        this.deductMatch(id1);
        this.deductMatch(id2);

        // console.log(`[match] chatId=${chatId} ${id1}(${u1.username}) <-> ${id2}(${u2.username})`);
      }
    } catch (err) {
      console.error("[SocketService] Matching loop error:", err);
    } finally {
      // 3. Always release the lock
      this.isMatching = false;
      
      // 4. Recursive Check: If users joined while we were yielding, run again immediately
      if (queue.length >= 2) {
        this.tryMatchUsers(queue);
      }
    }
  }

  startStatsInterval() {
    if (this.statsInterval) return;
    this.statsInterval = setInterval(async () => {
      if (this.io) {
        const room = this.io.sockets.adapter.rooms.get('admins');
        if (room && room.size > 0) {
          const stats = await this.gatherStats();
          this.io.to('admins').emit('admin-stats', stats);
        }
      }
    }, 3000);
  }

  async gatherStats() {
    const socketStats = this.getRealTimeStats();
    const dbStats = await adminService.getDashboardStats();
    return { ...socketStats, ...dbStats };
  }

  getRealTimeStats() {
    const activeUsersCount = this.userSockets.size;
    
    // Count actually paired users (assuming 2 per chat)
    let pairedUsersCount = 0;
    this.activeChats.forEach(chat => {
      if (chat.users && chat.users.length > 0) {
        pairedUsersCount += chat.users.length;
      }
    });

    const waitingInQueueCount = this.queueReference.length;
    const idleUsersCount = Math.max(0, activeUsersCount - pairedUsersCount - waitingInQueueCount);

    return {
      activeUsers: activeUsersCount,
      usersInQueue: waitingInQueueCount,
      pairedUsers: pairedUsersCount,
      idleUsers: idleUsersCount // Online but not in chat or queue
    };
  }

  // ✅ 2. Add the Janitor Function
  startQueueJanitor() {
    console.log('[Janitor Jose Gonzales] Service started. Sweeping queue every 30s.');
    
    setInterval(() => {
      if (!this.queueReference || this.queueReference.length === 0) return;

      const initialCount = this.queueReference.length;
      const now = Date.now();

      // Iterate BACKWARDS so we can remove items safely
      for (let i = this.queueReference.length - 1; i >= 0; i--) {
        const user = this.queueReference[i];
        const socket = this.userSockets.get(user.userId);

        // 🧹 SWEEP CRITERIA:
        // 1. Socket object doesn't exist?
        // 2. Socket claims it's disconnected?
        if (!socket || !socket.connected) {
          
          // Remove from queue
          this.queueReference.splice(i, 1);
          
          // Clean up memory maps
          this.userSockets.delete(user.userId);
          this.userSessions.delete(user.userId);
          this.userSocketMap.delete(user.userId);
          
          console.log(`[Janitor] Swept ghost user: ${user.userId}`);
        }
      }

      const finalCount = this.queueReference.length;
      if (initialCount !== finalCount) {
        console.log(`[Janitor] Cleanup complete. Removed ${initialCount - finalCount} ghosts. Queue size: ${finalCount}`);
      }
    }, 30000); // Run every 30 seconds
  }
}

module.exports = new SocketService();