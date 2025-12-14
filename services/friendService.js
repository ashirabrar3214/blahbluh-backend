const supabase = require('../config/supabase');

class FriendService {
  async sendFriendRequest(fromUserId, toUserId) {
    console.log('🔍 Checking existing friend request between:', fromUserId, 'and', toUserId);
    
    try {
      // Check for existing request
      const { data: existing, error: checkError } = await supabase
        .from('friend_requests')
        .select('id')
        .eq('from_user_id', fromUserId)
        .eq('to_user_id', toUserId)
        .eq('status', 'pending')
        .single();

      console.log('📄 Existing request check result:', { existing, checkError });

      if (existing) {
        console.log('⚠️ Friend request already exists');
        return { success: false, message: 'Friend request already sent' };
      }

      console.log('💾 Inserting new friend request into database');
      const insertData = {
        from_user_id: fromUserId,
        to_user_id: toUserId,
        status: 'pending',
        created_at: new Date().toISOString()
      };
      console.log('📝 Insert data:', insertData);

      const { data, error } = await supabase
        .from('friend_requests')
        .insert(insertData)
        .select()
        .single();

      console.log('📊 Insert result:', { data, error });

      if (error) {
        console.error('❌ Supabase insert error:', error);
        return { success: false, message: 'Database not available' };
      }
      
      console.log('✅ Friend request created successfully:', data);
      return { success: true, data };
    } catch (error) {
      console.error('❌ Friend request service error:', error);
      return { success: false, message: 'Service unavailable' };
    }
  }

  async acceptFriendRequest(requestId, userId) {
    const { data: request, error: fetchError } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('id', requestId)
      .eq('to_user_id', userId)
      .single();

    if (fetchError) throw fetchError;

    // Update request status
    await supabase
      .from('friend_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    // Add to friends table
    const { data, error } = await supabase
      .from('friends')
      .insert([
        { user_id: request.from_user_id, friend_id: request.to_user_id },
        { user_id: request.to_user_id, friend_id: request.from_user_id }
      ]);

    if (error) throw error;
    return data;
  }

  async getFriendRequests(userId) {
    try {
      const { data, error } = await supabase
        .from('friend_requests')
        .select(`
          *,
          from_user:users!friend_requests_from_user_id_fkey(id, username)
        `)
        .eq('to_user_id', userId)
        .eq('status', 'pending');

      if (error) {
        console.error('Supabase error:', error);
        return []; // Return empty array instead of throwing
      }
      return data || [];
    } catch (error) {
      console.error('Database connection error:', error);
      return []; // Return empty array for now
    }
  }

  async getFriends(userId) {
    const { data, error } = await supabase
      .from('friends')
      .select(`
        friend:users!friends_friend_id_fkey(id, username)
      `)
      .eq('user_id', userId);

    if (error) throw error;
    return data.map(f => f.friend);
  }

  async blockUser(userId, blockedUserId) {
    const { data, error } = await supabase
      .from('blocked_users')
      .insert({
        user_id: userId,
        blocked_user_id: blockedUserId,
        created_at: new Date().toISOString()
      });

    if (error) throw error;
    return data;
  }

  async isBlocked(userId1, userId2) {
    const { data, error } = await supabase
      .from('blocked_users')
      .select('id')
      .or(`and(user_id.eq.${userId1},blocked_user_id.eq.${userId2}),and(user_id.eq.${userId2},blocked_user_id.eq.${userId1})`);

    if (error) throw error;
    return data.length > 0;
  }

  async getFriendChats(userId) {
    console.log('🔍 Getting friend chats for:', userId);
    try {
      // For now, return empty array since we don't have chat functionality yet
      return [];
    } catch (error) {
      console.error('❌ Friend chats service error:', error);
      return [];
    }
  }

  async getChatMessages(chatId) {
    console.log('🔍 Getting messages for chat:', chatId);
    try {
      // For now, return empty array since we don't have chat messages yet
      return [];
    } catch (error) {
      console.error('❌ Chat messages service error:', error);
      return [];
    }
  }
}

module.exports = new FriendService();