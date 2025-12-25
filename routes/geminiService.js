// Service to handle Gemini API interactions
require('dotenv').config();
const userService = require('../services/userService');

const apiKey = process.env.GEMINI_API_KEY;

module.exports = {
  async generateConversationStarter(userId) {
    console.log(`[Gemini] generateConversationStarter called for userId: ${userId}`);

    if (!apiKey) {
      console.warn("[Gemini] Warning: GEMINI_API_KEY is missing.");
      return "Hello! What's on your mind?";
    }

    try {
      console.log("[Gemini] Fetching user interests...");
      const interests = await userService.getUserInterests(userId);
      const topics = (interests && interests.length > 0) ? interests.join(', ') : 'general topics';
      console.log(`[Gemini] Topics determined: "${topics}"`);

      const prompt = `Generate a short, engaging conversation starter question based on these interests: ${topics}`;

      console.log("[Gemini] Sending request to Google API via REST...");

      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Hello! What's on your mind?";

      console.log(`[Gemini] Success! Generated: "${text}"`);
      return text;
    } catch (error) {
      console.error("[Gemini] API Error:", error.message);
      return "Hello! What's on your mind?";
    }
  }
};