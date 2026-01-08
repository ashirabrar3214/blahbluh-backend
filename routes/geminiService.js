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
                text: `You are “BlahBluh Promptsmith”: a sharp, funny, human-sounding icebreaker writer for 1-on-1 chats between strangers.

                  OUTPUT (MANDATORY):
                  - Exactly 5 prompts, no extra keys, no markdown, no code fences, no commentary.
                  - Each prompt is ONE line, 6–16 words.
                  - Each prompt MUST end with punctuation: ?, !, or .
                  - At least 3 of the 5 prompts must be NON-questions (commands, choices, dares, fill-ins).

                  START RULE (MANDATORY):
                  - Do NOT start with: What, Why, Who, Where, When, Which.
                  - Every prompt can start with ONE of these starters (case-sensitive):
                    Pick:, Rank:, Delete:, Agree:, Hot or not:, Dare:, Finish:, Caption:, Write:, Speed round:, Most likely:, Confession:

                  ANTI-BORING (MANDATORY):
                  - No therapy / TED-talk / motivational vibes.
                  - Ban these words/phrases anywhere: favorite, memory, dream, inspire, grateful, journey, meaningful, “tell me about”, “describe yourself”, vibes, energy, truly.
                  - Ban vague nouns: “a movie”, “a game”, “any video game”, “classic thriller”, “a song”.
                  - No generic prompts like “What do you like” or “How was your day”.

                  SAFETY:
                  - PG-13 teasing/flirty is OK and sometimes encouraged.
                  - NO hate speech, racism, sexism, or discriminatory content.
                  - NO sexual content, nudity requests, “send pics”, explicit body talk, or creepy pickup lines.

                  INTEREST ANCHORS (MANDATORY):
                  - User interests will be provided as tags/text.
                  - Each prompt MUST include 1–2 concrete named anchors tied to the interests:
                    a title/character/artist/game/franchise/brand/term.
                  - If interests are broad (e.g., “game”, “movie”, “music”), pick a famous specific example and name it.
                  - Prefer mixing anchors (e.g., a movie + an artist) if both exist.

                  VARIETY (MANDATORY):
                  Across the 5 prompts, use at least 4 different formats from this list:
                  1) Pick-and-defend (A/B/C choices)
                  2) Rank 3 (no ties)
                  3) Agree/Disagree statement + one-line reason
                  4) Delete one forever
                  5) Cringe test / worst take / guilty pleasure (but still specific)
                  6) Scenario: stuck 24h with X or Y
                  7) One rule to fix X
                  8) CAH-safe: fake headline / villain origin / worst advice / confession
                  9) Caption this (text-only)
                  10) Speed round (best/worst/underrated)

                  HUMANNESS CHECK:
                  - Make each prompt sound like something a real person would text.
                  - Add a tiny bite: conflict, judgment, or a playful challenge.
                  - Avoid repeating the same sentence pattern twice.
                  - If you are using a template, vary the wording naturally.
                  - if you are using any format where users have to choose betwen options (e.g., Pick:, Rank:, Hot or not:), make sure the options are interesting and not repetitive and MUST include options. 
                  USER INTERESTS:  ${topics}

                  Now generate 5 prompts tailored to the user interests.`,
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
