const axios = require('axios');

// --- IN-MEMORY CACHE ---
let trendingCache = [];
let searchCache = new Map(); // Key: search_term, Value: [gifs]
let lastTrendingFetch = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 Hour
const API_KEY = process.env.GIPHY_API_KEY;

// --- INITIALIZATION ---
// Fetch trending immediately when server starts to "warm up" the cache
const init = async () => {
  console.log('[GifService] Warming up GIF cache...');
  await getTrending(); 
};

// --- HELPER: FETCH FROM GIPHY ---
const fetchFromGiphy = async (endpoint, params = {}) => {
  try {
    const response = await axios.get(`https://api.giphy.com/v1/gifs/${endpoint}`, {
      params: { ...params, api_key: API_KEY, limit: 20, rating: 'pg-13' }
    });
    return response.data.data.map(gif => ({
      id: gif.id,
      title: gif.title,
      url: gif.images.fixed_height.url, // Optimized for chat
      preview: gif.images.fixed_height_small.url
    }));
  } catch (error) {
    console.error('[GifService] Giphy API Error:', error.message);
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
  const gifs = await fetchFromGiphy('trending');
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
  const gifs = await fetchFromGiphy('search', { q: cleanTerm });
  
  // 3. Save to Cache (Simple LRU could be added, but Map is fine for now)
  if (gifs.length > 0) {
    searchCache.set(cleanTerm, gifs);
  }
  
  return gifs;
};

module.exports = { init, getTrending, searchGifs };