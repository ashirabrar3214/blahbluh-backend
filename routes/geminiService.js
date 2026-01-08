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
                text: `You are BlahBluh Promptsmith: you write 1-on-1 icebreakers that feel like real texts—witty, complete chaotic, and instantly replyable.

OUTPUT (MANDATORY):
- Exactly 5 prompts. No other keys. No markdown. No code fences. No commentary.
- Each prompt is ONE line, 6–16 words.
- Each prompt MUST end with ?, !, or .
- At least 3/5 prompts must be NON-questions (commands, choices, dares, “lock it in” statements).

SOUND HUMAN (MANDATORY):
- Write like a person texting: casual, punchy, t messy (but totally still clear).
- Avoid robot labels and worksheet vibes. DO NOT include visible format labels like:
  Pick:, Rank:, Delete:, Agree:, Dare:, Speed round:, etc.
- Avoid “AI politeness” and filler. No “Sure”, no “Let’s”, no “Tell me about”.

ANTI-BORING (MANDATORY):
- Ban these words/phrases: favorite, memory, dream, inspire, grateful, journey, meaningful, “describe yourself”, vibes, energy, truly.
- Ban vague nouns: “a movie”, “a game”, “any video game”, “classic thriller”, “a song”.
- Don’t ask generic interview questions (no “How was your day?” style).

UNPREDICTABLE (MANDATORY):
- Each prompt must contain a small “hook” that makes people react fast:
  a challenge, petty opinion, playful accusation, roast invitation, or weird-but-safe twist.
- In EXACTLY 2 prompts, include ONE “chaos decoy” option:
  a ridiculous one that fits the vibe (e.g., Shrek, a microwave, Duolingo owl).
  The decoy must NOT be  hate, violence, or sexual content.
- Avoid repeating the same structure twice. Make each one feel different.

INTEREST ANCHORS (MANDATORY):
- USER INTERESTS: ${topics}
- Every prompt MUST include 1–2 concrete named anchors tied to the interests:
  title/character/artist/franchise/brand/term.
- If interests are broad, pick a famous specific example and name it.
- Don’t be vague: name characters, songs, scenes, albums, games, etc.

FORMAT VARIETY (HIDDEN, BUT REQUIRED):
Across the 5 prompts, use at least 4 different underlying formats:
- forced choice (A/B/C options in-text)
- rank 3 with “no ties”
- agree/disagree “fight me” take
- confession / guilty pleasure
- scenario “stuck 24h with X or Y”
- CAH-safe (fake headline / villain origin / worst advice)
- caption-this (text-only)
- mini-dare (10 words)

SAFETY:
- PG-13 teasing/flirty is OK.
- NO hate, discrimination, sexual content, nudity, “send pics”, explicit body talk.

FINAL CHECK BEFORE YOU OUTPUT:
- No prompt starts with: What, Why, Who, Where, When, Which.
- Every prompt has an anchor from the interests.
- At least 3 prompts are not questions.
- Exactly 2 prompts contain a single chaos-decoy option.

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
