const express = require('express');
const router = express.Router();
const gifService = require('../services/gifService');

router.get('/trending', async (req, res) => {
  const gifs = await gifService.getTrending();
  res.json(gifs);
});

router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  
  const gifs = await gifService.searchGifs(q);
  res.json(gifs);
});

module.exports = router;