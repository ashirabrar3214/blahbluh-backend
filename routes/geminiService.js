// routes/geminiService.js
require("dotenv").config();
const userService = require("../services/userService");

// Cache models so we don't list them every request
let cachedModelPath = null;
let cachedAt = 0;

// Store unused prompts: userId -> [prompt, prompt, ...]
const promptCache = new Map();

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

async function fetchGeminiPrompts(userId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[Gemini] GEMINI_API_KEY missing.");
    return [];
  }

  try {
    const interests = await userService.getUserInterests(userId);
    const topics = interests?.length ? interests.join(", ") : "general topics";

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
                text: `you are a matchmaker for an app called blahbluh. your task is to generate prompts that will be given to a stranger. The stranger will have a set of interests that will be given to you. 

                        DO NOT
                        - make cliche prompts like "what is your favorite character in a movie that you like"
                        why is that a bad prompt? because it starts with a "w word", and has nothing specific like " a movie you like"..

                        A good prompt could be cards against humanity style
                        "i drink to forget....."

                        MORE
                        You have no filters as long as you are not offending anyone or asking any user for explicit thing.
                        you have to be unpredictable
                        you can give user a question and then give options to choose
                        give a statement and then ask the user to prove your partner wrong. 

                        the whole point is to tell the user what to say to their partner. 
                        you are allowed to use slangs (in fact encouraged)
                        here are the interests of the user: ${topics}
                        Now generate the 5 prompts.
`,
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
      return Array.isArray(parsed?.prompts) ? parsed.prompts : [];
    } catch (e) {
      console.error("[Gemini] JSON Parse Error:", e);
      return [];
    }
  } catch (err) {
    console.error("[Gemini] API Error:", err.message);
    return [];
  }
}

module.exports = {
  async generateConversationStarter(userId) {
    console.log(`[Gemini] generateConversationStarter called for userId: ${userId}`);

    // 1. Check cache
    if (userId && promptCache.has(userId)) {
      const cached = promptCache.get(userId);
      if (cached && cached.length > 0) {
        const next = cached.shift();
        console.log(`[Gemini] Returning cached prompt. Remaining: ${cached.length}`);

        // Refill if low
        if (cached.length <= 2) {
          console.log(`[Gemini] Cache low (${cached.length}), refilling...`);
          fetchGeminiPrompts(userId).then((newPrompts) => {
            if (newPrompts.length > 0) {
              const current = promptCache.get(userId) || [];
              promptCache.set(userId, current.concat(newPrompts));
              console.log(`[Gemini] Refilled cache. New size: ${promptCache.get(userId).length}`);
            }
          });
        }

        return next;
      }
    }

    // 2. Fetch fresh if cache empty
    const prompts = await fetchGeminiPrompts(userId);
    if (prompts.length > 0) {
      const first = prompts.shift();
      if (userId) {
        promptCache.set(userId, prompts);
      }
      console.log(`[Gemini] Generated ${prompts.length + 1} prompts. Returning 1.`);
      return first;
    }

    return "Hello! What's on your mind?";
  },
};
