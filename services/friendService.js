const supabase = require('../config/supabase');

class FriendService {
  async sendFriendRequest(fromUserId, toUserId) {
    const { data, error } = await supabase
      .from('friend_requests')
      .insert({
        from_user_id: fromUserId,
        to_user_id: toUserId,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      throw error;
    }
    return data;
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
    const { data, error } = await supabase
      .from('friend_requests')
      .select(`
        *,
        from_user:users!friend_requests_from_user_id_fkey(id, username)
      `)
      .eq('to_user_id', userId)
      .eq('status', 'pending');

    if (error) throw error;
    return data;
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
}

module.exports = new FriendService();