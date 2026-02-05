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
    console.log(`🔍 Looking for invite: ${inviteId}`); // DEBUG LOG

    const { data, error } = await supabase
      .from('friend_invites')
      .select(`
        *,
        sender:users!friend_invites_sender_id_fkey(username, pfp, pfp_background)
      `)
      .eq('id', inviteId)
      .single();

    // DEBUG LOGS
    if (error) console.error("❌ Supabase Error:", error); 
    if (!data) console.error("❌ No data found (Check RLS policies!)");

    if (error || !data) throw new Error('Invite not found');
    
    // Check expiry
    const now = new Date();
    const expiry = new Date(data.expires_at);
    console.log(`🕒 Time Check: Now=${now.toISOString()} vs Expire=${expiry.toISOString()}`);

    if (now > expiry) {
      throw new Error('Invite expired');
    }

    return data;
  }

  async acceptInvite(inviteId, recipientId) {
    const invite = await this.getInvite(inviteId);
    
    if (invite.sender_id === recipientId) {
      throw new Error("You cannot accept your own invite");
    }

    // Create friendship immediately
    // We reuse the logic from friendService but force the "accepted" status
    // 1. Check if friendship already exists
    const { data: existing } = await supabase
        .from('friends')
        .select('*')
        .or(`and(user_id.eq.${invite.sender_id},friend_id.eq.${recipientId}),and(user_id.eq.${recipientId},friend_id.eq.${invite.sender_id})`)
        .maybeSingle();
        
    if (!existing) {
        // Create 2-way friendship
        await supabase.from('friends').insert([
            { user_id: invite.sender_id, friend_id: recipientId },
            { user_id: recipientId, friend_id: invite.sender_id }
        ]);
    }

    return { 
        senderId: invite.sender_id, 
        prompt: invite.prompt_text 
    };
  }
}

module.exports = new InviteService();