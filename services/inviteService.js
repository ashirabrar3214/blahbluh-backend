// services/inviteService.js
// services/inviteService.js
const supabase = require('../config/supabase');

class InviteService {

  // 1. Create the Card (Unchanged)
  async createInvite(senderId, promptText) {
    const { data, error } = await supabase
      .from('friend_invites')
      .insert({
        sender_id: senderId,
        prompt_text: promptText,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // 2. Get Card Details (Added Expiry Check)
  async getInvite(inviteId) {
    const { data, error } = await supabase
      .from('friend_invites')
      .select(`*, sender:users!friend_invites_sender_id_fkey(username, pfp)`)
      .eq('id', inviteId)
      .single();

    if (error || !data) throw new Error('Card not found');
    return data;
  }

  // 3. Accept & Start Yap Session (THE BIG CHANGE)
  async acceptInvite(inviteId, respondentId, answerText) {
    const invite = await this.getInvite(inviteId);
    
    if (invite.sender_id === respondentId) throw new Error("You can't answer your own card");
    if (invite.respondent_id) throw new Error("This card was already answered!");

    // A. Calculate Expiry (24 hours from NOW)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // +24 hours

    // B. Create the "Room ID"
    // We don't use friend IDs anymore. We use the Invite ID itself.
    const yapRoomId = `yap_${inviteId}`;

    // C. Update Invite: Lock it & Set Timers
    const { error: updateError } = await supabase
        .from('friend_invites')
        .update({ 
            is_active: false, // ✅ card is no longer pending once answered
            respondent_id: respondentId,
            chat_started_at: now.toISOString(),
            chat_expires_at: expiresAt.toISOString()
        }) 
        .eq('id', inviteId);

    if (updateError) throw updateError;

    // D. Insert the ANSWER as the first message
    const { error: msgError } = await supabase.from('messages').insert({
        room_id: yapRoomId,
        sender_id: respondentId,
        text: answerText,
        created_at: now.toISOString()
    });

    if (msgError) console.error("Message Error:", msgError);

    return { 
        success: true, 
        roomId: yapRoomId, // Frontend sends user to /chat/yap_UUID
        expiresAt 
    };
  }

  // 4. Get My Sent Cards (For "My Yaps" Dashboard)
  async getMyInvites(userId) {
      // Fetch cards I sent that were answered (session active) OR are still pending
      const now = new Date().toISOString();
      
      const { data, error } = await supabase
        .from('friend_invites')
        .select(`
            *,
            respondent:users!friend_invites_respondent_id_fkey(username, pfp, pfp_background)
        `)
        .eq('sender_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filter: Show Pending items AND Active chats (not expired)
      return data.filter(item => {
        // answered chat still alive
        if (item.chat_expires_at) {
          return new Date(item.chat_expires_at) > new Date();
        }

        // pending invite is only valid if still active AND not expired AND not answered
        const notExpired = new Date(item.expires_at) > new Date();
        return item.is_active && !item.respondent_id && notExpired;
      });
  }

  // 5. Get Session Data (For the Chat Window)
  async getYapSession(inviteId, userId) {
      // Fetch the Invite (Prompt) + Messages
      const { data: invite } = await supabase
          .from('friend_invites')
          .select(`
            *,
            sender:users!friend_invites_sender_id_fkey(username, pfp, pfp_background),
            respondent:users!friend_invites_respondent_id_fkey(username, pfp, pfp_background)
          `)
          .eq('id', inviteId)
          .single();

      if (!invite) throw new Error("Session not found");

      // Verify User is Participant
      if (invite.sender_id !== userId && invite.respondent_id !== userId) {
          throw new Error("Unauthorized");
      }

      // Fetch Messages for this specific room
      const { data: messages } = await supabase
          .from('messages')
          .select('*')
          .eq('room_id', `yap_${inviteId}`)
          .order('created_at', { ascending: true });

      return { invite, messages };
  }
}

module.exports = new InviteService();