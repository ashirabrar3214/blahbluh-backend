const express = require('express');
const friendService = require('../services/friendService');
const router = express.Router();

router.post('/friend-request', async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;
    const request = await friendService.sendFriendRequest(fromUserId, toUserId);
    res.json(request);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/accept-friend', async (req, res) => {
  try {
    const { requestId, userId } = req.body;
    await friendService.acceptFriendRequest(requestId, userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/friend-requests/:userId', async (req, res) => {
  try {
    const requests = await friendService.getFriendRequests(req.params.userId);
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/friends/:userId', async (req, res) => {
  try {
    const friends = await friendService.getFriends(req.params.userId);
    res.json(friends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/block', async (req, res) => {
  try {
    const { userId, blockedUserId } = req.body;
    await friendService.blockUser(userId, blockedUserId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;