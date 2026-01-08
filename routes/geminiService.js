// routes/geminiService.js
require("dotenv").config();
const crypto = require("crypto");
const userService = require("./services/userService");

/**
 * If you're on Node 18+, fetch is global. This fallback keeps you safe on older runtimes.
 */
async function getFetch() {
  if (typeof fetch === "function") return fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

// Cache models so we don't list them every request
let cachedModelPath = null;
let cachedAt = 0;

function getApiKey() {
  return (process.env.GEMINI_API_KEY || "").trim();
}

/**
 * Paste your prompt here OR set env CONVO_SYSTEM_PROMPT.
 * Keep it as a SYSTEM instruction, not a user message.
 */
const SYSTEM_PROMPT =
  (process.env.CONVO_SYSTEM_PROMPT || "").trim() ||
  `
You write 1-on-1 icebreakers for strangers. They must feel human, punchy, playful, slightly chaotic.

OUTPUT MUST BE ONLY valid JSON with this exact shape:
{"prompts":["...","...","...","...","..."]}

Rules:
- Exactly 5 prompts.
- Each prompt is a single line string.
- 6–16 words each.
- Must start with one of: Pick, Rank, Delete, Agree, Hot or not, Dare, Finish, Caption, Write, Speed round, Most likely.
- Must end with ?, !, or .
- No labels like "Hot take:".
- No generic phrases like "a movie", "a game", "any".
- No extra keys, no trailing commas, no markdown.
- If you cannot comply, output exactly: {"prompts":[]}

STYLE:
- Prompts can be questions OR interactive statements (MCQ, rank, dare, fill-blank).
- Never start with: What/Why/Who/Where/When/Which.
- Ban boring openers: "If you love", "Imagine", "Tell me about".

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
- CAH-safe (fake headline, villain origin, worst advice, confession)`;

/**
 * Hard fallback prompts (keeps your app from dying if Gemini flakes).
 */
const FALLBACK_PROMPTS = [
  "Pick: coffee date or late-night drive — defend your choice.",
  "Rank: the three worst traits in a group chat — no ties.",
  "Agree or disagree: roasting is flirting, if done right.",
  "Dare: write a 10-word line that would actually make you reply.",
  "Delete one forever: ghosting, dry texting, or vague plans — why?",
];

async function listModels(apiKey) {
  const _fetch = await getFetch();
  const res = await _fetch("https://generativelanguage.googleapis.com/v1beta/models", {
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
  const usable = models.filter(
    (m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")
  );

  // Prefer "flash" (fast/cheap), then "pro", else first usable.
  const preferred =
    usable.find((m) => /gemini-2\./i.test(m.name) && /flash/i.test(m.name)) ||
    usable.find((m) => /flash/i.test(m.name)) ||
    usable.find((m) => /pro/i.test(m.name)) ||
    usable[0];

  return preferred?.name || null; // e.g. "models/gemini-2.5-flash"
}

async function getWorkingModelPath(apiKey) {
  const now = Date.now();
  if (cachedModelPath && now - cachedAt < 10 * 60 * 1000) return cachedModelPath;

  const models = await listModels(apiKey);
  const picked = pickBestTextModel(models);

  if (!picked) {
    throw new Error(
      "No usable models returned by ListModels. Your key/project might not have Gemini API enabled or is restricted."
    );
  }

  cachedModelPath = picked;
  cachedAt = now;
  console.log("[Gemini] Picked model:", cachedModelPath);
  return cachedModelPath;
}

function safeJsonExtract(text) {
  // If Gemini ever adds junk around JSON, pull the first {...} block.
  const m = String(text || "").match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

function normalizePrompts(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => String(s ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function isValidPromptList(arr) {
  if (!Array.isArray(arr) || arr.length !== 5) return false;

  // keep your existing vibe rules but don’t be so strict you brick output
  const startsBad = /^(what|why|who|where|when|which)\b/i;
  const badEnd = /(\btheir\b|\bto\b|\band\b|\bor\b|\bwith\b)$/i;

  return arr.every((p) => {
    const words = p.split(/\s+/).filter(Boolean);
    if (words.length < 5 || words.length > 22) return false;
    if (startsBad.test(p)) return false;
    if (badEnd.test(p)) return false;
    // allow question OR statement (still end with punctuation)
    if (!/[?.!]$/.test(p)) return false;
    return true;
  });
}

async function callGemini({ apiKey, modelPath, systemPrompt, userText, temperature }) {
  const _fetch = await getFetch();
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;

  // IMPORTANT: use responseSchema (not responseJsonSchema)
  const body = {
    systemInstruction: {
      role: "system",
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      temperature,
      topP: 0.95,
      maxOutputTokens: 900,
      responseMimeType: "application/json",
      responseSchema: {
      type: "OBJECT",
      properties: {
        prompts: {
          type: "ARRAY",
          minItems: 5,
          maxItems: 5,
          items: { type: "STRING" },
        },
      },
      required: ["prompts"],
    }

    },
  };

  const res = await _fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text(); // read once
  if (!res.ok) {
    throw new Error(`generateContent failed: ${res.status} ${res.statusText} - ${rawText}`);
  }

  // For debugging: you can log rawText safely (it's JSON from the API, not your prompts JSON)
  // console.log("[Gemini] API raw response:", rawText);

  const data = JSON.parse(rawText);

  // Join ALL parts (sometimes output is split)
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const modelText = parts.map((p) => p?.text ?? "").join("");

  return {
    finishReason: candidate?.finishReason,
    modelText,
  };
}

module.exports = {
  async generateConversationStarter(userId) {
    console.log(`[Gemini] generateConversationStarter called for userId: ${userId}`);

    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn("[Gemini] GEMINI_API_KEY missing.");
      return FALLBACK_PROMPTS;
    }

    // If you forget to paste your prompt, don’t silently send garbage.
    if (!SYSTEM_PROMPT || SYSTEM_PROMPT.includes("PASTE_YOUR_SYSTEM_PROMPT_HERE")) {
      console.warn("[Gemini] SYSTEM_PROMPT is not set (CONVO_SYSTEM_PROMPT or file constant).");
      return FALLBACK_PROMPTS;
    }

    const reqId = crypto.randomUUID?.() || String(Date.now());
    try {
      const interests = await userService.getUserInterests(userId);
      const topics = interests?.length ? interests.join(", ") : "general";

      const modelPath = await getWorkingModelPath(apiKey);

      // Keep user message simple; your actual “style law” lives in SYSTEM_PROMPT.
      const userText = `User interests: ${topics}\nReturn exactly 5 prompts as JSON.`;

      const temps = [1.05, 0.9, 0.75]; // retry with less chaos if it misbehaves
      let lastGood = [];

      for (let attempt = 0; attempt < temps.length; attempt++) {
        const t = temps[attempt];

        const { finishReason, modelText } = await callGemini({
          apiKey,
          modelPath,
          systemPrompt: SYSTEM_PROMPT,
          userText,
          temperature: t,
        });

        console.log(`[Gemini][${reqId}] finishReason(attempt ${attempt + 1}):`, finishReason);
        console.log(`[Gemini][${reqId}] modelTextLen(attempt ${attempt + 1}):`, modelText?.length ?? 0);
        console.log(`[Gemini][${reqId}] modelTextRAW(attempt ${attempt + 1}):`, JSON.stringify(modelText));

        if (!modelText) continue;

        let parsed;
        try {
          parsed = JSON.parse(safeJsonExtract(modelText));
        } catch (e) {
          console.error(`[Gemini][${reqId}] JSON parse failed(attempt ${attempt + 1}):`, e.message);
          continue;
        }

        const prompts = normalizePrompts(parsed?.prompts);
        if (prompts.length) lastGood = prompts;

        if (isValidPromptList(prompts)) {
          return prompts;
        }
      }

      return lastGood.length === 5 ? lastGood : FALLBACK_PROMPTS;
    } catch (err) {
      console.error(`[Gemini][${reqId}] API Error:`, err.message);
      return FALLBACK_PROMPTS;
    }
  },
};
