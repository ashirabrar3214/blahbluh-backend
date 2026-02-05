const express = require('express');
const router = express.Router();
const inviteService = require('../services/inviteService');

// Create Invite
router.post('/create', async (req, res) => {
  try {
    const { senderId, promptText } = req.body;
    const invite = await inviteService.createInvite(senderId, promptText);
    
    // Use env variable for the link, fallback to localhost for dev
    const baseUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/invite/${invite.id}`;
    
    res.json({ success: true, shareUrl, inviteId: invite.id });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Invite
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
    // We now expect 'answerText' from the frontend
    const { inviteId, userId, answerText } = req.body;
    
    if (!answerText) {
        return res.status(400).json({ error: "Answer text is required" });
    }

    const result = await inviteService.acceptInvite(inviteId, userId, answerText);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add the "My Yaps" route
router.get('/mine/:userId', async (req, res) => {
    try {
        const invites = await inviteService.getMyInvites(req.params.userId);
        res.json(invites);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;