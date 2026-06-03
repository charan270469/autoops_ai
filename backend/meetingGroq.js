import Groq from "groq-sdk";

const SYSTEM_PROMPT =
  "You are a Meeting Intelligence Agent. Extract all actionable items from this meeting transcript. For each action item return: task, owner, deadline, priority (HIGH/MEDIUM/LOW), dependencies. Return ONLY a valid JSON array, no other text, no markdown backticks.";

/** In-memory transcript → last successful API-shaped result (without source) */
const transcriptCache = new Map();

const MAX_API_ATTEMPTS = 4;
const RETRY_DELAY_MS = 5000;
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

function delay(ms) { 
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKeyForTranscript(transcript) {
  return transcript.trim().replace(/\s+/g, " ");
}

function stripCodeFences(text) {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im;
  const m = s.match(fence);
  if (m) return m[1].trim();
  return s;
}

function normalizeTask(raw) {
  const deps = raw.dependencies ?? raw.Dependencies ?? "";
  return {
    task: String(raw.task ?? raw.Task ?? "").trim(),
    owner: String(raw.owner ?? raw.Owner ?? "Unassigned").trim(),
    deadline: String(raw.deadline ?? raw.Deadline ?? "TBD").trim(),
    priority: normalizePriority(raw.priority ?? raw.Priority ?? "MEDIUM"),
    dependencies: Array.isArray(deps)
      ? deps.map(String)
      : String(deps).trim() || undefined,
  };
}

function normalizePriority(p) {
  const u = String(p).toUpperCase();
  if (/\bHIGH\b/.test(u) || u.startsWith("HIGH")) return "HIGH";
  if (/\bLOW\b/.test(u) || u.startsWith("LOW")) return "LOW";
  if (/\bMEDIUM\b/.test(u) || u.startsWith("MEDIUM")) return "MEDIUM";
  return "MEDIUM";
}

/**
 * Two-sentence summary when the model returns only a task array.
 * @param {string} transcript
 * @param {ReturnType<typeof normalizeTask>[]} tasks
 */
function buildMeetingSummary(transcript, tasks) {
  const n = tasks.length;
  const preview = transcript.replace(/\s+/g, " ").trim().slice(0, 140);
  const first = `This meeting yielded ${n} actionable item(s) with owners, deadlines, and priorities captured.`;
  const second = preview
    ? `Key context from the transcript: ${preview}${transcript.trim().length > 140 ? "…" : ""}`
    : "Track each item to completion to keep deliverables on schedule.";
  return `${first} ${second}`;
}

/**
 * @param {string} content
 * @param {string} transcript
 */
function parseGroqMessageContent(content, transcript) {
  const stripped = stripCodeFences(content);
  let data;
  try {
    data = JSON.parse(stripped);
  } catch {
    throw new Error("Could not parse model output as JSON");
  }

  let tasksRaw;
  if (Array.isArray(data)) {
    tasksRaw = data;
  } else if (data && Array.isArray(data.tasks)) {
    tasksRaw = data.tasks;
  } else {
    throw new Error("Expected a JSON array of action items");
  }

  const tasks = tasksRaw.map((t) => normalizeTask(t));
  const summary = buildMeetingSummary(transcript, tasks);
  const totalTasks = tasks.length;
  const highPriorityCount = tasks.filter((t) => t.priority === "HIGH").length;

  return { tasks, summary, totalTasks, highPriorityCount };
}

function buildFallbackMock(transcript) {
  const preview = cacheKeyForTranscript(transcript).slice(0, 160);
  const full = cacheKeyForTranscript(transcript);
  const ellipses = preview.length < full.length ? "…" : "";
  return {
    tasks: [
      normalizeTask({
        task: "Review meeting notes and confirm action items with owners",
        owner: "Unassigned",
        deadline: "TBD",
        priority: "MEDIUM",
        dependencies: "Full Groq extraction unavailable",
      }),
      normalizeTask({
        task: "Re-run meeting analysis when API quota or connectivity permits",
        owner: "Team lead",
        deadline: "TBD",
        priority: "LOW",
        dependencies: "Groq API",
      }),
    ],
    summary: `The meeting discussion was recorded${preview ? ` (“${preview}${ellipses}”)` : ""}. Automated extraction is temporarily unavailable, so placeholder tasks were returned.`,
    totalTasks: 2,
    highPriorityCount: 0,
    source: "fallback",
  };
}

function getErrorStatus(err) {
  if (!err || typeof err !== "object") return undefined;
  if ("status" in err && typeof err.status === "number") return err.status;
  if (err.response && typeof err.response.status === "number")
    return err.response.status;
  return undefined;
}

/**
 * @param {string} transcript
 * @param {string} apiKey
 * @returns {Promise<{ tasks: object[], summary: string, totalTasks: number, highPriorityCount: number, source: 'cache' | 'api' | 'fallback' }>}
 */
export async function analyzeTranscriptWithGroq(transcript, apiKey) {
  const key = cacheKeyForTranscript(transcript);
  if (!key) {
    throw new Error("Transcript is empty");
  }

  const cached = transcriptCache.get(key);
  if (cached) {
    console.log(
      "[meeting-intelligence] result from cache (same normalized transcript)"
    );
    return {
      tasks: cached.tasks.map((t) => ({ ...t })),
      summary: cached.summary,
      totalTasks: cached.totalTasks,
      highPriorityCount: cached.highPriorityCount,
      source: "cache",
    };
  }

  const groq = new Groq({ apiKey });
  const model = process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;

  let lastStatus = 0;
  let lastErrorMessage = "";

  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    console.log(
      `[meeting-intelligence] Groq API attempt ${attempt}/${MAX_API_ATTEMPTS} (model ${model})`
    );

    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: key },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const resultText = completion.choices?.[0]?.message?.content ?? "";
      if (!resultText.trim()) {
        throw new Error("Empty Groq completion");
      }

      try {
        const parsed = parseGroqMessageContent(resultText, transcript);
        transcriptCache.set(key, { ...parsed });
        console.log(
          `[meeting-intelligence] result from API (success on attempt ${attempt})`
        );
        return { ...parsed, source: "api" };
      } catch (parseErr) {
        lastStatus = 200;
        lastErrorMessage =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        console.warn(
          "[meeting-intelligence] Groq response OK but parse failed:",
          lastErrorMessage
        );
        break;
      }
    } catch (err) {
      const status = getErrorStatus(err);
      lastStatus = status ?? 0;
      lastErrorMessage = err instanceof Error ? err.message : String(err);
      const is429 = status === 429;

      if (is429 && attempt < MAX_API_ATTEMPTS) {
        console.log(
          `[meeting-intelligence] HTTP 429 on attempt ${attempt}; waiting ${RETRY_DELAY_MS / 1000}s before retry`
        );
        await delay(RETRY_DELAY_MS);
        continue;
      }

      console.warn(
        `[meeting-intelligence] Groq error on attempt ${attempt}:`,
        lastErrorMessage
      );
      break;
    }
  }

  const fallback = buildFallbackMock(transcript);
  const { source: _s, ...toCache } = fallback;
  transcriptCache.set(key, toCache);
  console.log(
    `[meeting-intelligence] using fallback mock (last status ${lastStatus || "n/a"}; source=fallback)`
  );
  if (lastErrorMessage) {
    console.log(
      "[meeting-intelligence] last error (truncated):",
      lastErrorMessage.slice(0, 400)
    );
  }
  return fallback;
}

export function clearMeetingTranscriptCache() {
  transcriptCache.clear();
}
