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

      const badEnd = /(\btheir\b|\bto\b|\band\b|\bor\b|\bwith\b)$/i;
      const startsBad = /^(what|why|who|where|when|which)\b/i;
      const allowedStart = /^(Pick|Rank|Delete|Agree|Hot or not|Dare|Finish|Caption|Write|Speed round|Most likely)\b/;

      const isValid = (arr) =>
        arr.length === 5 &&
        arr.every(p =>
          p.split(/\s+/).length >= 6 &&
          p.split(/\s+/).length <= 16 &&
          /[?.!]$/.test(p) &&
          !startsBad.test(p) &&
          allowedStart.test(p) &&
          !badEnd.test(p)
        );

      let attempts = 0;
      let prompts = [];

      while (attempts < 2) {
        attempts++;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              role: "system",
              parts: [
                {
                  text: `
You write 1-on-1 icebreakers for strangers. They must feel human, punchy, playful, slightly chaotic.

OUTPUT:
- Return EXACTLY 5 prompts joined by "|||".
- No extra text, no newlines, no numbering, no bullets.

STYLE:
- Prompts can be questions OR interactive statements (MCQ, rank, dare, fill-blank).
- Never start with: What/Why/Who/Where/When/Which.
- EVERY prompt MUST start with ONE of these: Pick, Rank, Delete, Agree, Hot or not, Dare, Finish, Caption, Write, Speed round, Most likely.
- EVERY prompt MUST end with ?, !, or . (no cut-off fragments).
- Ban boring openers: "If you love", "Imagine", "Tell me about".
- 6–16 words each.

ANTI-BORING RULES:
- DO NOT include labels like "Hot take:", "Guilty pleasure:", "Dropped into:".
- DO NOT use vague nouns like "a movie", "a game", "any video game", "classic thriller", "a song".
- DO NOT do TED-talk / therapy vibes (ban: dream, purpose, grateful, inspire, motivation, childhood, journey).
- Max 2 fill-in-the-blank prompts total.

SPECIFICITY:
- Each prompt MUST include at least one concrete anchor from the interests:
  title/character/artist/game/franchise/genre/term.
- If interests are broad, pick a famous specific example and name it.
- Avoid clichés and “favorite memory” framing.

VARIETY:
Use at least 3 different formats across the 5 prompts:
- Pick-one-and-defend (A/B/C)
- Rank 3 (no ties)
- Agree/Disagree statement
- Worst take / cringe test / guilty pleasure
- Scenario (“stuck 24h with X or Y”)
- Mini-date choice
- Playful dare (10 words)
- CAH-safe (fake headline, villain origin, worst advice, confession)
        `.trim(),
              },
            ],
          },

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `User interests: ${topics}
                  Generate 5 prompts now.`,
                },
              ],
            },
          ],

          generationConfig: {
            temperature: 1.1,
            topP: 0.95,
            topK: 40,
              maxOutputTokens: 320,
          },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`generateContent failed: ${response.status} ${response.statusText} - ${errText}`);
        }

        const data = await response.json();
        console.log("[Gemini] candidateParts:", JSON.stringify(data?.candidates?.[0]?.content?.parts, null, 2));
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log(`[Gemini] textLen(attempt ${attempts}):`, text?.length);
        console.log(`[Gemini] RAW(attempt ${attempts}):`, JSON.stringify(text)); // shows \n, \r, etc
        console.log(`[Gemini] TAIL(attempt ${attempts}):`, JSON.stringify(text?.slice(-120)));
        process.stdout.write(`[Gemini] FULL(attempt ${attempts}):\n${text}\n---\n`);
        if (!text) continue;

        const candidates = text.split(/\|{3,}/).map(p => p.trim()).filter(Boolean);
        if (isValid(candidates)) {
          return candidates;
        }
        prompts = candidates;
      }

      return prompts.length > 0 ? prompts : ["Hello! What's on your mind?"];
    } catch (err) {
      console.error("[Gemini] API Error:", err.message);
      return ["Hello! What's on your mind?"];
    }
  },
};
