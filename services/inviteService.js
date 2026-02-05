// services/inviteService.js
const supabase = require('../config/supabase');
const friendService = require('./friendService');

class InviteService {
  async createInvite(senderId, promptText) {
    const { data, error } = await supabase
      .from('friend_invites')
      .insert({
        sender_id: senderId,
        prompt_text: promptText
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getInvite(inviteId) {
    const { data, error } = await supabase
      .from('friend_invites')
      .select(`
        *,
        sender:users!friend_invites_sender_id_fkey(username, pfp, pfp_background)
      `)
      .eq('id', inviteId)
      .single();

    if (error || !data) throw new Error('Invite not found');
    
    // Check expiry
    if (new Date() > new Date(data.expires_at)) {
      throw new Error('Invite expired');
    }

    return data;
  }

  async acceptInvite(inviteId, recipientId, answerText) {
    const invite = await this.getInvite(inviteId);
    
    if (invite.sender_id === recipientId) {
      throw new Error("You cannot accept your own invite");
    }

    // 1. Create Friendship (if not exists)
    const { data: existing } = await supabase
        .from('friends')
        .select('*')
        .or(`and(user_id.eq.${invite.sender_id},friend_id.eq.${recipientId}),and(user_id.eq.${recipientId},friend_id.eq.${invite.sender_id})`)
        .maybeSingle();
        
    if (!existing) {
        await supabase.from('friends').insert([
            { user_id: invite.sender_id, friend_id: recipientId, status: 'yapping' },
            { user_id: recipientId, friend_id: invite.sender_id, status: 'yapping' }
        ]);
    }

    // 2. Post the Answer as the first Message!
    const sortedIds = [invite.sender_id, recipientId].sort();
    const roomId = `friend_${sortedIds[0]}_${sortedIds[1]}`;

    if (answerText) {
      await supabase.from('friend_messages').insert({
          chat_id: roomId,
          sender_id: recipientId,
          receiver_id: invite.sender_id,
          message: answerText
      });
    }

    // 3. Mark Invite as "Answered"
    await supabase
        .from('friend_invites')
        .update({ is_active: false })
        .eq('id', inviteId);

    return { 
        senderId: invite.sender_id, 
        roomId: roomId 
    };
  }

  async getMyInvites(userId) {
      const { data } = await supabase
        .from('friend_invites')
        .select('*')
        .eq('sender_id', userId)
        .order('created_at', { ascending: false });
      return data;
  }
}

module.exports = new InviteService();