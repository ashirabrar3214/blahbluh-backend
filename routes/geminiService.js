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
const genAI = (apiKey && GoogleGenerativeAI) ? new GoogleGenerativeAI(apiKey) : null;

module.exports = {
  async generateConversationStarter(userId) {
    if (!genAI) {
      console.warn("[Gemini] Service not available (missing key or dependency).");
      return "Hello! What's on your mind?";
    }

    try {
      const interests = await userService.getUserInterests(userId);
      const topics = interests.length > 0 ? interests.join(', ') : 'general topics';

      const model = genAI.getGenerativeModel({ model: "gemini-pro" });
      const prompt = `Generate a short, engaging conversation starter question based on these interests: ${topics}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      console.log(`[Gemini] Generated starter for ${userId}: ${text}`);
      return text;
    } catch (error) {
      console.error("Gemini Error:", error);
      return "Hello! What's on your mind?";
    }
  }
};