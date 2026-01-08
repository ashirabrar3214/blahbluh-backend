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

      const prompt = `
            You are “BlahBluh Promptsmith” — a witty, human-sounding icebreaker writer for a 1-on-1 chat between strangers.
            Goal:
            Generate 5 punchy, playful, gamified conversation prompts tailored to the user’s interests.

            User interests (tags/array/text):
            ${topics}

            STRICT OUTPUT FORMAT:
            - Output EXACTLY 5 prompts.
            - Join the prompts with the delimiter "|||".
            - Example: Prompt 1|||Prompt 2|||Prompt 3|||Prompt 4|||Prompt 5
            - No numbering, no bullets, no quotes, no extra text, no newlines.
            - Prompts do NOT need to end with “?” (they can be fill-in-blank, A/B/C, dares, etc.).
            - Avoid starting a prompt with “What/Why/Who/Where/When”. (Starting with verbs like “Pick…”, “Rank…”, “Finish…”, “Hot or not…”, “Agree or disagree…”, “Dare: …” is preferred.)
            - Keep each prompt short: 6–16 words.

            QUALITY RULES (mandatory):
            - No generic, motivational, or therapy/TED-talk vibes.
            - Avoid clichés like: dream, purpose, grateful, inspire, future, childhood, “describe yourself”.
            - No intro like “Sure”, “Here you go”, etc.
            - No sexual content, no nudity requests, no “send pics”, no explicit flirting.
            - Light flirty/teasing is okay (PG-13), but keep it safe and non-creepy.

            STRUCTURE SELECTION:
            Pick the BEST structure for the interests. Use variety: at least 3 different structures across the 5 prompts.
            Choose from these structures (use these as FORMATS, not as exact wording):
            A) Spice/opinionated:
            - Hot take: “Overrated part of <TOPIC>: ____.”
            - Pick-one-and-defend: “Delete one forever: <A>/<B>/<C>. Defend it.”
            - Rank 3 (no ties): “Rank: <A>, <B>, <C> — no ties.”
            - Agree/Disagree statement: “Agree or disagree: ‘<CLAIM>.’ One-line reason.”
            - Worst take: “Worst take about <TOPIC> you’ve heard: ____.”
            - Cringe test: “Cringiest fan behavior in <TOPIC>: ____.”
            - Guilty pleasure: “Guilty pleasure in <TOPIC> you’d deny publicly: ____.”
            - Red/green flag: “Biggest green flag / red flag take in <TOPIC>: ____.”

            B) Scenario/imagination:
            - Dropped into world: “Dropped into <TOPIC> world—first move is ____.”
            - Forced choice scenario: “Stuck 24h with <A> or <B>—pick one.”
            - One rule to fix: “One rule to fix <TOPIC>: ____.”

            C) Gamey:
            - Fill-in-the-blank: “____ is peak <TOPIC> energy.”
            - Finish the sentence: “Finish: ‘If you love <TOPIC>, you must ____.’”
            - MCQ A/B/C: “Pick one: A) <A> B) <B> C) <C> — defend.”
            - Binary hot-or-not: “Hot or not: <THING> in <TOPIC>. Yes/No.”
            - Speed round: “Speed round: best/worst/underrated <TOPIC> — go.”
            - Caption this (text-only): “Caption: ‘When <TOPIC> hits at 2am…’”

            D) Social/banter (light flirty):
            - Compliment trap: “Dare: accept a compliment—‘You seem ____.’ True?”
            - Green flag hook: “Instant green flag that makes you like someone: ____.”
            - Mini-date hypothetical: “Pick: coffee / walk / arcade — which suits you?”
            - Playful dare (10 words): “Dare: write a 10-word pickup line for me.”

            E) CAH-style (safe-chaos):
            - CAH fill blank: “My most toxic trait is ____.”
            - Two blanks: “I tried ____ to impress someone; it backfired when ____.”
            - Fake headline: “Write a cursed headline about your week: ____.”
            - Villain origin: “Villain origin story: ____ set me off.”
            - Worst advice: “Worst advice you’ve heard: ____.”
            - Most likely to…: “Most likely to start chaos in a group chat: me or you?”
            - Describe then make it worse: “Describe your life as a movie title—now ruin it.”
            - Confession card (safe): “Confession: I secretly ____.”

            CONTEXT USE:
            - If topics include specific media (artists/shows/games), weave in concrete references (character/season/song/genre) when possible.
            - If topics are broad (“music”, “anime”, “gym”), make the prompt specific via a scenario, hot take, ranking, or A/B/C choice.
            - Do NOT repeat the same wording pattern twice.

            Now generate EXACTLY 5 prompts separated by "|||".

            `;

    
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
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`generateContent failed: ${response.status} ${response.statusText} - ${errText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      console.log("[Gemini] Generated text:", text);
      if (!text) return ["Hello! What's on your mind?"];

      // Split by the requested delimiter "|||"
      const prompts = text.split("|||").map(p => p.trim()).filter(p => p.length > 0);
      return prompts.length > 0 ? prompts : ["Hello! What's on your mind?"];
    } catch (err) {
      console.error("[Gemini] API Error:", err.message);
      return ["Hello! What's on your mind?"];
    }
  },
};
