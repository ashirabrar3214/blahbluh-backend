// Service to handle Gemini API interactions
require('dotenv').config();
const userService = require('../services/userService');

const apiKey = process.env.GEMINI_API_KEY;

module.exports = {
  async generateConversationStarter(userId) {
    console.log(`[Gemini] generateConversationStarter called for userId: ${userId}`);

    if (!process.env.GEMINI_API_KEY) {
        console.warn("[Gemini] GEMINI_API_KEY missing.");
        return "Hello! What's on your mind?";
    }

    try {
        const interests = await userService.getUserInterests(userId);
        const topics =
        interests && interests.length > 0
            ? interests.join(", ")
            : "general topics";

        const prompt = `Generate a short, engaging conversation starter question based on these interests: ${topics}`;

        const response = await fetch(
        "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
        {
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
            contents: [
                {
                parts: [{ text: prompt }]
                }
            ]
            })
        }
        );

        if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
        }

        const data = await response.json();
        return (
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Hello! What's on your mind?"
        );
    } catch (err) {
        console.error("[Gemini] API Error:", err.message);
        return "Hello! What's on your mind?";
    }
}
};