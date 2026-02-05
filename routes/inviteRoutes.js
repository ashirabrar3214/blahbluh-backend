const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Generate a unique invite link
router.post('/create', async (req, res) => {
  try {
    const { senderId, promptText } = req.body;
    
    // 1. Create the invite record
    const { data, error } = await supabase
      .from('friend_invites')
      .insert({ sender_id: senderId, prompt_text: promptText })
      .select('id')
      .single();

    if (error) throw error;

    // FIX: Use the environment variable, fallback to localhost only for dev
    const baseUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    res.json({ success: true, shareUrl: `${baseUrl}/invite/${data.id}` });
  } catch (error) {
    console.error('Invite error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 