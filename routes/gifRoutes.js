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

// ... NEW STICKER ROUTES ...
router.get('/stickers/trending', async (req, res) => {
  const stickers = await gifService.getTrendingStickers();
  res.json(stickers);
});

router.get('/stickers/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  const stickers = await gifService.searchStickers(q);
  res.json(stickers);
});

module.exports = router;