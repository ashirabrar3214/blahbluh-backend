// routes/inviteRoutes.js
const express = require('express');
const router = express.Router();
const inviteService = require('../services/inviteService');

// Create Invite
router.post('/create', async (req, res) => {
  try {
    const { senderId, promptText } = req.body;
    const invite = await inviteService.createInvite(senderId, promptText);
    
    // Return the full shareable URL
    // Assumes CLIENT_URL is set in env, e.g., https://blahbluh.com
    const baseUrl = process.env.CLIENT_URL || 'http://localhost:3001';
    const shareUrl = `${baseUrl}/invite/${invite.id}`;
    
    res.json({ success: true, shareUrl, inviteId: invite.id });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Invite Details (for the landing page)
router.get('/:id', async (req, res) => {
  try {
    const invite = await inviteService.getInvite(req.params.id);
    res.json(invite);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// Accept Invite
router.post('/accept', async (req, res) => {
  try {
    const { inviteId, userId } = req.body;
    const result = await inviteService.acceptInvite(inviteId, userId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;