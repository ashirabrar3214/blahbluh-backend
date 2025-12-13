const express = require('express');
const userService = require('../services/userService');
const router = express.Router();

router.get('/generate-user-id', async (req, res) => {
  try {
    const user = await userService.createUser();
    res.json({ userId: user.id, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:userId', async (req, res) => {
  try {
    const user = await userService.getUser(req.params.userId);
    res.json(user);
  } catch (error) {
    res.status(404).json({ error: 'User not found' });
  }
});

router.put('/:userId', async (req, res) => {
  try {
    const user = await userService.updateUser(req.params.userId, req.body);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:userId/report', async (req, res) => {
  try {
    const user = await userService.reportUser(req.params.userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:userId/friends', async (req, res) => {
  try {
    const { friendId } = req.body;
    const user = await userService.addFriend(req.params.userId, friendId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:userId/block', async (req, res) => {
  try {
    const { blockedUserId } = req.body;
    const user = await userService.blockUser(req.params.userId, blockedUserId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;