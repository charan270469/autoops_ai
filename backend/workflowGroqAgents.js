import Groq from "groq-sdk";

const MODEL = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";

const DECISION_SYSTEM_PROMPT = `You are a Decision Agent in an autonomous workflow engine. 
When given a failed step, decide the recovery action.
Return ONLY valid JSON:
{
  decision: RETRY | SKIP | ESCALATE,
  reasoning: string,
  confidence: number between 0.7 and 0.95
}
No markdown, no explanation, just JSON.`;

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a Workflow Orchestrator Agent in an autonomous workflow engine.
Given the workflow step that is now executing and overall progress, return ONLY valid JSON:
{
  "coordinationNote": "string — one sentence on how to align stakeholders for this step",
  "watchouts": "string — one sentence on risks, blockers, or dependencies to monitor"
}
No markdown, no explanation, just JSON.`;

function stripCodeFences(text) {
  let s = String(text).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im;
  const m = s.match(fence);
  if (m) return m[1].trim();
  return s;
}

function clampConfidence(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0.82;
  return Math.min(0.95, Math.max(0.7, x));
}

function normalizeDecision(raw) {
  const s = String(raw ?? "").trim();
  const u = s.toUpperCase();
  if (u.includes("RETRY")) return "RETRY";
  if (u.includes("SKIP")) return "SKIP";
  if (u.includes("ESCALATE")) return "ESCALATE";
  return null;
}

/**
 * @param {{ operatorHint: string, workflow: object, target: { index: number, phase: string }, step: object }} ctx
 */
export async function decideRecoveryWithGroq(ctx) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.log(
      "[decision-agent] GROQ_API_KEY missing — using operator hint fallback"
    );
    return null;
  }

  const groq = new Groq({ apiKey });
  const payload = {
    operatorRecoveryHint: ctx.operatorHint,
    failedStep: {
      id: ctx.step.id,
      status: ctx.step.status,
      phase: ctx.target.phase,
      assignedAgent: ctx.step.assignedAgent,
      startTime: ctx.step.startTime,
      endTime: ctx.step.endTime,
    },
    recentLogs: ctx.step.logs.slice(-10),
    workflow: {
      id: ctx.workflow.id,
      runStatus: ctx.workflow.runStatus,
      nextStepIndex: ctx.workflow.nextStepIndex,
      totalSteps: ctx.workflow.steps.length,
      stepStatuses: ctx.workflow.steps.map((s) => ({ id: s.id, status: s.status })),
    },
  };

  console.log("[decision-agent] calling Groq (model " + MODEL + ", temp 0.2)");

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: DECISION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Context JSON:\n${JSON.stringify(payload, null, 0)}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 500,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) {
    throw new Error("Empty decision agent completion");
  }

  let data;
  try {
    data = JSON.parse(stripCodeFences(raw));
  } catch {
    throw new Error("Decision agent returned non-JSON");
  }

  const decision = normalizeDecision(data.decision);
  if (!decision) {
    throw new Error("Invalid decision from agent");
  }

  const out = {
    decision,
    reasoning: String(data.reasoning ?? "").slice(0, 2000) || "No reasoning provided.",
    confidence: clampConfidence(data.confidence),
  };
  console.log(
    "[decision-agent] Groq decision:",
    out.decision,
    "confidence:",
    out.confidence
  );
  return out;
}

/**
 * @param {object} workflow
 * @param {number} stepIndex
 */
export async function orchestrateStepWithGroq(workflow, stepIndex) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.log("[orchestrator] GROQ_API_KEY missing — skipping orchestration hint");
    return null;
  }

  const step = workflow.steps[stepIndex];
  const groq = new Groq({ apiKey });

  const payload = {
    workflowId: workflow.id,
    runningStepIndex: stepIndex,
    step: {
      id: step.id,
      assignedAgent: step.assignedAgent,
      status: step.status,
    },
    progress: {
      nextStepIndex: workflow.nextStepIndex,
      completedOrSkipped: workflow.steps.filter((s) =>
        ["success", "skipped"].includes(s.status)
      ).length,
      total: workflow.steps.length,
    },
  };

  console.log(
    "[orchestrator] calling Groq (model " + MODEL + ", temp 0.2)"
  );

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: ORCHESTRATOR_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Orchestration context:\n${JSON.stringify(payload, null, 0)}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 400,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) return null;

  let data;
  try {
    data = JSON.parse(stripCodeFences(raw));
  } catch {
    console.warn("[orchestrator] failed to parse JSON from Groq");
    return null;
  }

  const out = {
    coordinationNote: String(data.coordinationNote ?? data.coordination ?? "").slice(
      0,
      1000
    ),
    watchouts: String(data.watchouts ?? data.watchout ?? "").slice(0, 1000),
  };
  console.log("[orchestrator] Groq hint recorded");
  return out;
}

/**
 * @param {string} hint transient | dependency | hard
 */
export function fallbackRecoveryFromOperatorHint(hint) {
  const map = {
    transient: {
      decision: "RETRY",
      reasoning:
        "Operator requested transient recovery; defaulting to retry with bounded attempts.",
      confidence: 0.82,
    },
    dependency: {
      decision: "SKIP",
      reasoning:
        "Operator requested dependency-style recovery; defaulting to skip and continue pipeline.",
      confidence: 0.82,
    },
    hard: {
      decision: "ESCALATE",
      reasoning:
        "Operator requested hard failure handling; defaulting to escalate for human review.",
      confidence: 0.88,
    },
  };
  return map[hint] ?? map.hard;
}
