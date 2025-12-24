// Service to handle Gemini API interactions
require('dotenv').config();
const userService = require('../services/userService');

let GoogleGenerativeAI;
try {
  ({ GoogleGenerativeAI } = require("@google/generative-ai"));
} catch (error) {
  console.warn("[Gemini] Dependency '@google/generative-ai' not found. AI features disabled.");
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("[Gemini] Warning: GEMINI_API_KEY is missing from environment variables.");
} else {
  console.log("[Gemini] API Key loaded successfully. AI Service is ready.");
}

const genAI = (apiKey && GoogleGenerativeAI) ? new GoogleGenerativeAI(apiKey) : null;

module.exports = {
  async generateConversationStarter(userId) {
    console.log(`[Gemini] generateConversationStarter called for userId: ${userId}`);

    if (!genAI) {
      console.warn("[Gemini] Service skipped: API key or Dependency missing.");
      return "Hello! What's on your mind?";
    }

    try {
      console.log("[Gemini] Fetching user interests...");
      const interests = await userService.getUserInterests(userId);
      const topics = (interests && interests.length > 0) ? interests.join(', ') : 'general topics';
      console.log(`[Gemini] Topics determined: "${topics}"`);

      const model = genAI.getGenerativeModel({ model: "gemini-pro" });
      const prompt = `Generate a short, engaging conversation starter question based on these interests: ${topics}`;

      console.log("[Gemini] Sending request to Google API...");
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      console.log(`[Gemini] Success! Generated: "${text}"`);
      return text;
    } catch (error) {
      console.error("[Gemini] API Error:", error.message);
      if (error.response) console.error("[Gemini] Full Error Details:", JSON.stringify(error.response, null, 2));
      return "Hello! What's on your mind?";
    }
  }
};