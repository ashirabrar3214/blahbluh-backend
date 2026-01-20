const axios = require('axios');

// Allowed Domains and specific patterns for "Short" content
const ALLOWED_PATTERNS = [
  // Instagram (Reels are short form)
  { domain: 'instagram.com', regex: /instagram\.com\/reels?\/[\w-]+\/?/ },
  // TikTok (All content is short)
  { domain: 'tiktok.com', regex: /tiktok\.com\/@[\w.-]+\/video\/\d+/ },
  { domain: 'vm.tiktok.com', regex: /vm\.tiktok\.com\/[\w-]+\/?/ },
  // Snapchat (Spotlight/Stories)
  { domain: 'snapchat.com', regex: /snapchat\.com\/(?:@[\w.-]+\/)?(add|spotlight|story)\/[^/?#]+\/?/ },
  { domain: 't.snapchat.com', regex: /t\.snapchat\.com\/[^/?#]+\/?/ },
  // Twitter / X (Standard posts)
  { domain: 'twitter.com', regex: /twitter\.com\/\w+\/status\/\d+/ },
  { domain: 'x.com', regex: /x\.com\/\w+\/status\/\d+/ },
  // Reddit (Comments/Posts)
  { domain: 'reddit.com', regex: /reddit\.com\/r\/\w+\/comments\// },
];

const validateClipUrl = async (url) => {
  try {
    const trimmedUrl = url.trim();
    
    // 1. Basic URL Syntax Check
    const urlObj = new URL(trimmedUrl);
    
    // 2. Domain & Pattern Whitelist Check
    const match = ALLOWED_PATTERNS.find(p => 
      urlObj.hostname.includes(p.domain) && p.regex.test(trimmedUrl)
    );

    if (!match) {
      return { 
        valid: false, 
        error: 'Domain not allowed or invalid format. Only Instagram Reels, TikTok, Snapchat, Twitter, and Reddit links are supported.' 
      };
    }

    // Skip reachability check for Snapchat as they aggressively block HEAD/bots
    if (urlObj.hostname.includes('snapchat.com')) {
      return { valid: true, cleanUrl: trimmedUrl };
    }

    // 3. "Real" Check (Reachability)
    // We use a HEAD request with a fake User-Agent to avoid immediate 403s from bot protections
    // Note: Some sites (like TikTok) aggressively block HEAD, so we might fallback to GET with small byte limit if needed,
    // but a basic 200/301/302 check catches mostly "broken" links.
    try {
        await axios.head(trimmedUrl, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
            validateStatus: (status) => status < 404 // Accept redirects and success
        });
    } catch (networkErr) {
        // If HEAD fails, sometimes it's just method not allowed, try a lightweight GET
        if (networkErr.response?.status === 405) {
             // 405 Method Not Allowed - URL likely exists but dislikes HEAD
             return { valid: true, cleanUrl: trimmedUrl }; 
        }
        console.error('Link reachability check failed:', networkErr.message);
        return { valid: false, error: 'Link appears to be broken or unreachable.' };
    }

    return { valid: true, cleanUrl: trimmedUrl };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format.' };
  }
};

module.exports = { validateClipUrl };