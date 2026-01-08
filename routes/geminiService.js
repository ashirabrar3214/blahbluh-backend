// routes/geminiService.js
require("dotenv").config();
const userService = require("../services/userService");

// Cache models so we don't list them every request
let cachedModelPath = null;
let cachedAt = 0;

function getApiKey() {
  return (process.env.GEMINI_API_KEY || "").trim();
}

async function listModels(apiKey) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    method: "GET",
    headers: { "x-goog-api-key": apiKey },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ListModels failed: ${res.status} ${res.statusText} - ${txt}`);
  }

  const data = await res.json();
  return data.models || [];
}

function pickBestTextModel(models) {
  // Only models that support generateContent
  const usable = models.filter(
    (m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")
  );

  // Prefer flash variants (cheap/fast). If not found, take first usable.
  const preferred =
    usable.find((m) => /flash/i.test(m.name)) ||
    usable.find((m) => /pro/i.test(m.name)) ||
    usable[0];

  return preferred?.name || null; // ex: "models/gemini-1.5-flash-001"
}

async function getWorkingModelPath(apiKey) {
  // cache for 10 minutes
  const now = Date.now();
  if (cachedModelPath && now - cachedAt < 10 * 60 * 1000) return cachedModelPath;

  const models = await listModels(apiKey);
  const picked = pickBestTextModel(models);

  if (!picked) {
    throw new Error(
      "No usable models returned by ListModels. Your key/project might not have Gemini API enabled or is restricted."
    );
  }

  cachedModelPath = picked; // keep full "models/..." path
  cachedAt = now;
  console.log("[Gemini] Picked model:", cachedModelPath);
  return cachedModelPath;
}

module.exports = {
  async generateConversationStarter(userId) {
    console.log(`[Gemini] generateConversationStarter called for userId: ${userId}`);

    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn("[Gemini] GEMINI_API_KEY missing.");
      return "Hello! What's on your mind?";
    }

    try {
      const interests = await userService.getUserInterests(userId);
      const topics = interests?.length ? interests.join(", ") : "general topics";

      // Auto-select a model your key can actually use
      const modelPath = await getWorkingModelPath(apiKey);
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Generate 5 fun, short icebreaker questions for someone interested in: ${topics}.`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                prompts: {
                  type: "ARRAY",
                  items: {
                    type: "STRING"
                  }
                }
              },
              required: ["prompts"]
            }
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`generateContent failed: ${response.status} ${response.statusText} - ${errText}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      console.log("[Gemini] Raw output:", JSON.stringify(text));

      try {
        const parsed = JSON.parse(text);
        const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts : ["Hello! What's on your mind?"];
        console.log(prompts);
        return prompts;
      } catch (e) {
        console.error("[Gemini] JSON Parse Error:", e);
        return ["Hello! What's on your mind?"];
      }
    } catch (err) {
      console.error("[Gemini] API Error:", err.message);
      return ["Hello! What's on your mind?"];
    }
  },
};
