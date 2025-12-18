const express = require('express');
const userService = require('../services/userService');
const router = express.Router();

const queue = [];

router.post('/join-queue', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await userService.getUser(userId);
    
    if (!queue.find(u => u.id === userId)) {
      queue.push(user);
    }
    
    const position = queue.findIndex(u => u.id === userId) + 1;
    res.json({ userId: user.id, username: user.username, queuePosition: position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/leave-queue', (req, res) => {
  const { userId } = req.body;
  const index = queue.findIndex(u => u.id === userId);
  if (index !== -1) queue.splice(index, 1);
  res.json({ success: true });
});

router.get('/queue-status/:userId', (req, res) => {
  const { userId } = req.params;
  const index = queue.findIndex(u => u.id === userId);
  res.json({ inQueue: index !== -1, queuePosition: index + 1 });
});

module.exports = { router, queue };