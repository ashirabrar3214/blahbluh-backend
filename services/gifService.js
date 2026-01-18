const axios = require('axios');

// --- IN-MEMORY CACHE ---
let trendingCache = [];
let searchCache = new Map(); // Key: search_term, Value: [gifs]
let lastTrendingFetch = 0;

// --- STICKER CACHE ---
let trendingStickersCache = [];
let stickerSearchCache = new Map();
let lastStickerTrendingFetch = 0;

const CACHE_DURATION = 60 * 60 * 1000; // 1 Hour
const API_KEY = process.env.GIPHY_API_KEY;

// --- INITIALIZATION ---
// Fetch trending immediately when server starts to "warm up" the cache
const init = async () => {
  console.log('[GifService] Warming up caches...');
  await getTrending(); 
  await getTrendingStickers(); // Warm up stickers too
};

// --- HELPER: FETCH FROM GIPHY ---
const fetchFromGiphy = async (type, endpoint, params = {}) => {
  try {
    // type is 'gifs' or 'stickers'
    const response = await axios.get(`https://api.giphy.com/v1/${type}/${endpoint}`, {
      params: { ...params, api_key: API_KEY, limit: 20, rating: 'pg-13' }
    });
    return response.data.data.map(item => ({
      id: item.id,
      title: item.title,
      // Stickers often use 'fixed_height_small' for preview too
      url: item.images.fixed_height.url, 
      preview: item.images.fixed_height_small.url
    }));
  } catch (error) {
    console.error(`[GifService] Giphy ${type} Error:`, error.message);
    return [];
  }
};

// --- PUBLIC METHODS ---

const getTrending = async () => {
  const now = Date.now();
  // Return cache if fresh (less than 1 hour old)
  if (trendingCache.length > 0 && (now - lastTrendingFetch < CACHE_DURATION)) {
    return trendingCache;
  }

  // Otherwise, fetch new
  console.log('[GifService] Cache expired. Hitting Giphy API for Trending.');
  const gifs = await fetchFromGiphy('gifs', 'trending');
  if (gifs.length > 0) {
    trendingCache = gifs;
    lastTrendingFetch = now;
  }
  return trendingCache;
};

const searchGifs = async (term) => {
  const cleanTerm = term.trim().toLowerCase();
  
  // 1. Check Cache
  if (searchCache.has(cleanTerm)) {
    console.log(`[GifService] Serving "${cleanTerm}" from cache.`);
    return searchCache.get(cleanTerm);
  }

  // 2. Hit API
  console.log(`[GifService] Hitting Giphy API for search: "${cleanTerm}"`);
  const gifs = await fetchFromGiphy('gifs', 'search', { q: cleanTerm });
  
  // 3. Save to Cache (Simple LRU could be added, but Map is fine for now)
  if (gifs.length > 0) {
    searchCache.set(cleanTerm, gifs);
  }
  
  return gifs;
};

// --- NEW STICKER METHODS ---

const getTrendingStickers = async () => {
  const now = Date.now();
  if (trendingStickersCache.length > 0 && (now - lastStickerTrendingFetch < CACHE_DURATION)) {
    return trendingStickersCache;
  }
  console.log('[GifService] Fetching Trending Stickers...');
  const stickers = await fetchFromGiphy('stickers', 'trending');
  if (stickers.length > 0) {
    trendingStickersCache = stickers;
    lastStickerTrendingFetch = now;
  }
  return trendingStickersCache;
};

const searchStickers = async (term) => {
  const cleanTerm = term.trim().toLowerCase();
  
  if (stickerSearchCache.has(cleanTerm)) {
    return stickerSearchCache.get(cleanTerm);
  }

  console.log(`[GifService] Searching Stickers: "${cleanTerm}"`);
  const stickers = await fetchFromGiphy('stickers', 'search', { q: cleanTerm });
  
  if (stickers.length > 0) {
    stickerSearchCache.set(cleanTerm, stickers);
  }
  return stickers;
};

module.exports = { init, getTrending, searchGifs, getTrendingStickers, searchStickers };