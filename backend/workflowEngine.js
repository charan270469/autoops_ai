import { appendStepLog } from "./agentLogger.js";
import { getAssignedAgent, STEP_IDS } from "./mockAgents.js";
import {
  decideRecoveryWithGroq,
  fallbackRecoveryFromOperatorHint,
  orchestrateStepWithGroq,
} from "./workflowGroqAgents.js";

/** SLA: max expected duration per step (seconds) for health scoring */
export const STEP_SLA_SECONDS = 60;

/** Simulated agent execution delay (seconds) */
export const STEP_EXECUTION_DELAY_MS = 2000;

/** @typedef {'transient' | 'dependency' | 'hard'} FailureType */

/**
 * @typedef {'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'retrying' | 'escalated'} StepStatus
 */

/**
 * @typedef {Object} WorkflowStep
 * @property {string} id
 * @property {StepStatus} status
 * @property {string} assignedAgent
 * @property {string | null} startTime
 * @property {string | null} endTime
 * @property {number | null} duration
 * @property {Array<{ at: string, level: string, message: string }>} logs
 */

/**
 * @typedef {Object} AuditEvent
 * @property {string} id
 * @property {string} at
 * @property {string} type
 * @property {Record<string, unknown>} [payload]
 */

/**
 * @typedef {Object} Workflow
 * @property {string} id
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {'active' | 'completed' | 'failed' | 'escalated'} runStatus
 * @property {number} nextStepIndex
 * @property {boolean} executionLocked
 * @property {number} executionEpoch
 * @property {number} recoverySessionId
 * @property {string | null} escalationMessage
 * @property {WorkflowStep[]} steps
 * @property {AuditEvent[]} auditTrail
 */

const workflows = new Map();

/** @type {Record<string, { workflowId: string, message: string, urgency: string, affectedStep: string, recommendedAction: string, reasoning: string, escalatedAt: string }>} */
const escalations = Object.create(null);

/** @type {Set<(w: ReturnType<typeof getPublicWorkflow>) => void>} */
const listeners = new Set();

export function subscribeWorkflowChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(workflow) {
  workflow.updatedAt = new Date().toISOString();
  const snapshot = getPublicWorkflow(workflow);
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      /* ignore listener errors */
    }
  }
}

function pushAudit(workflow, type, payload = {}) {
  workflow.auditTrail.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type,
    payload,
  });
}

/** Heuristic recovery notes (e.g. after transient success) — mock confidence */
function pushRecoveryHeuristic(workflow, { action, reasoning }) {
  const confidence =
    Math.round((0.7 + Math.random() * 0.25) * 1000) / 1000;
  workflow.auditTrail.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type: "recovery.decision",
    payload: {
      agent: "DecisionAgent",
      action,
      reasoning,
      confidence: Math.min(0.95, confidence),
    },
  });
}

/** Groq Decision Agent output */
function pushRecoveryDecisionLLM(workflow, { decision, reasoning, confidence }) {
  const c = Math.min(0.95, Math.max(0.7, Number(confidence) || 0.82));
  workflow.auditTrail.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type: "recovery.decision",
    payload: {
      agent: "DecisionAgent",
      action: decision,
      reasoning,
      confidence: c,
    },
  });
}

function createBlankStep(stepId) {
  return {
    id: stepId,
    status: "pending",
    assignedAgent: getAssignedAgent(stepId),
    startTime: null,
    endTime: null,
    duration: null,
    logs: [],
  };
}

function completeStepSuccess(workflow, stepIndex) {
  const s = workflow.steps[stepIndex];
  const end = new Date();
  s.status = "success";
  s.endTime = end.toISOString();
  s.duration = Math.round(
    (end.getTime() - new Date(s.startTime).getTime()) / 1000
  );
  appendStepLog(s, `Agent ${s.assignedAgent} completed ${s.id}`, {
    level: "info",
  });
  pushAudit(workflow, "step.completed", {
    workflowId: workflow.id,
    stepId: s.id,
    durationSeconds: s.duration,
  });
  workflow.nextStepIndex = stepIndex + 1;
  workflow.executionLocked = false;
  if (workflow.nextStepIndex >= workflow.steps.length) {
    workflow.runStatus = "completed";
    pushAudit(workflow, "workflow.completed", { workflowId: workflow.id });
  }
}

/**
 * @param {Workflow} workflow
 * @param {number} stepIndex
 * @param {{ message: string, transient: boolean }} opts
 */
function escalateHuman(workflow, stepIndex, { message, transient }) {
  workflow.runStatus = "escalated";
  workflow.executionLocked = false;
  workflow.escalationMessage = message;
  const step = workflow.steps[stepIndex];
  appendStepLog(step, message, { level: "error" });
  pushRecoveryHeuristic(workflow, {
    action: transient
      ? "Escalate to human after transient retries exhausted"
      : "Escalate workflow for human review",
    reasoning: transient
      ? "All configured transient retries failed; automated recovery is insufficient."
      : "Critical failure path selected; safe default is human verification.",
  });
  pushAudit(workflow, "workflow.escalated", {
    workflowId: workflow.id,
    stepId: step?.id,
    message,
  });
}

/**
 * @param {Workflow} w
 * @returns {{ index: number, phase: 'running' | 'pending' } | null}
 */
function findFailTarget(w) {
  const runningIdx = w.steps.findIndex((s) => s.status === "running");
  if (runningIdx !== -1) return { index: runningIdx, phase: "running" };
  if (
    w.nextStepIndex < w.steps.length &&
    w.steps[w.nextStepIndex].status === "pending"
  ) {
    return { index: w.nextStepIndex, phase: "pending" };
  }
  return null;
}

/**
 * @param {string} workflowId
 * @param {number} stepIndex
 * @param {number} attempt
 * @param {number} recoverySid
 * @param {boolean} transientAllRetriesFail — if true, each retry execution fails until escalation (demo / test path).
 */
function beginTransientAttempt(
  workflowId,
  stepIndex,
  attempt,
  recoverySid,
  transientAllRetriesFail
) {
  const cur = workflows.get(workflowId);
  if (!cur || cur.recoverySessionId !== recoverySid || cur.runStatus !== "active") {
    return;
  }

  const step = cur.steps[stepIndex];
  const start = new Date();
  step.status = "running";
  step.startTime = start.toISOString();
  step.endTime = null;
  step.duration = null;
  appendStepLog(
    step,
    `Transient retry attempt ${attempt}/3`,
    { level: "warn" }
  );
  emit(cur);

  setTimeout(() => {
    const wf = workflows.get(workflowId);
    if (!wf || wf.recoverySessionId !== recoverySid || wf.runStatus !== "active") {
      return;
    }
    const s = wf.steps[stepIndex];
    if (!s || s.status !== "running") {
      return;
    }

    const shouldFailExecution = transientAllRetriesFail;

    if (!shouldFailExecution) {
      completeStepSuccess(wf, stepIndex);
      pushRecoveryHeuristic(wf, {
        action: `Transient recovery succeeded on attempt ${attempt}`,
        reasoning:
          "Transient fault cleared after isolated retry; no dependency or hard-fault signals detected.",
      });
      emit(wf);
      return;
    }

    const end = new Date();
    s.status = "failed";
    s.endTime = end.toISOString();
    s.duration = s.startTime
      ? Math.round((end.getTime() - new Date(s.startTime).getTime()) / 1000)
      : 0;
    appendStepLog(
      s,
      `Transient retry ${attempt}/3 did not succeed (simulated)`,
      { level: "error" }
    );
    emit(wf);

    if (attempt >= 3) {
      escalateHuman(wf, stepIndex, {
        message: `Transient retries exhausted (3). Human review required for step ${s.id}.`,
        transient: true,
      });
      emit(wf);
      return;
    }

    setTimeout(() => {
      const w2 = workflows.get(workflowId);
      if (!w2 || w2.recoverySessionId !== recoverySid || w2.runStatus !== "active") {
        return;
      }
      beginTransientAttempt(
        workflowId,
        stepIndex,
        attempt + 1,
        recoverySid,
        transientAllRetriesFail
      );
    }, 2000);
  }, STEP_EXECUTION_DELAY_MS);
}

/**
 * Waits 2s, then starts attempt 1. Between failed attempts, another 2s before the next attempt.
 */
function scheduleTransientRecovery(
  workflowId,
  stepIndex,
  transientAllRetriesFail,
  recoverySid
) {
  setTimeout(() => {
    const cur = workflows.get(workflowId);
    if (!cur || cur.recoverySessionId !== recoverySid || cur.runStatus !== "active") {
      return;
    }
    beginTransientAttempt(
      workflowId,
      stepIndex,
      1,
      recoverySid,
      transientAllRetriesFail
    );
  }, 2000);
}

/**
 * @returns {Workflow}
 */
export function createWorkflow() {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  /** @type {Workflow} */
  const workflow = {
    id,
    createdAt: now,
    updatedAt: now,
    runStatus: "active",
    nextStepIndex: 0,
    executionLocked: false,
    executionEpoch: 0,
    recoverySessionId: 0,
    escalationMessage: null,
    steps: STEP_IDS.map(createBlankStep),
    auditTrail: [],
  };
  pushAudit(workflow, "workflow.created", { workflowId: id });
  workflows.set(id, workflow);
  emit(workflow);
  return workflow;
}

/**
 * @param {string} workflowId
 * @returns {Workflow | undefined}
 */
export function getWorkflowById(workflowId) {
  return workflows.get(workflowId);
}

/**
 * Records n8n orchestration plan receipt on the workflow audit trail (if workflow exists).
 * @param {string} workflowId
 * @returns {boolean} true if a workflow was found and updated
 */
export function recordN8nPlanReceived(workflowId) {
  const w = workflows.get(workflowId);
  if (!w) return false;
  pushAudit(w, "n8n.plan.received", {
    agent: "OrchestratorAgent",
    action: "N8N_PLAN_RECEIVED",
    result: "success",
    reasoning: "Execution plan received from n8n orchestration layer",
    confidence: 0.95,
  });
  emit(w);
  return true;
}

/**
 * Serializable view (same shape clients receive).
 * @param {Workflow} workflow
 */
export function getPublicWorkflow(workflow) {
  return {
    id: workflow.id,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    runStatus: workflow.runStatus,
    nextStepIndex: workflow.nextStepIndex,
    executionLocked: workflow.executionLocked,
    escalationMessage: workflow.escalationMessage,
    steps: workflow.steps.map((s) => ({
      id: s.id,
      status: s.status,
      assignedAgent: s.assignedAgent,
      startTime: s.startTime,
      endTime: s.endTime,
      duration: s.duration,
      logs: [...s.logs],
    })),
  };
}

/**
 * @param {string} workflowId
 * @returns {AuditEvent[]}
 */
export function getAuditTrail(workflowId) {
  const w = workflows.get(workflowId);
  if (!w) return [];
  return w.auditTrail.map((e) => ({
    ...e,
    payload: e.payload ? { ...e.payload } : {},
  }));
}

/**
 * SLA health for a workflow.
 * @param {string} workflowId
 */
export function getHealth(workflowId) {
  const w = workflows.get(workflowId);
  if (!w) {
    return { found: false };
  }

  const failedSteps = w.steps.filter((s) => s.status === "failed");
  const successSteps = w.steps.filter((s) => s.status === "success");
  const running = w.steps.filter((s) => s.status === "running");
  const breached = w.steps.filter(
    (s) =>
      s.status === "failed" ||
      (typeof s.duration === "number" && s.duration > STEP_SLA_SECONDS)
  );

  let overall = "healthy";
  if (
    w.runStatus === "failed" ||
    w.runStatus === "escalated" ||
    failedSteps.length > 0
  ) {
    overall = "critical";
  } else if (breached.length > 0) {
    overall = "degraded";
  } else if (
    w.runStatus === "active" &&
    (running.length > 0 || successSteps.length < w.steps.length)
  ) {
    overall = running.length > 0 ? "in_progress" : "healthy";
  } else if (w.runStatus === "completed") {
    overall = "healthy";
  }

  return {
    found: true,
    workflowId: w.id,
    runStatus: w.runStatus,
    overall,
    slaThresholdSecondsPerStep: STEP_SLA_SECONDS,
    stepSummary: {
      total: w.steps.length,
      pending: w.steps.filter((s) => s.status === "pending").length,
      running: running.length,
      success: successSteps.length,
      failed: failedSteps.length,
      skipped: w.steps.filter((s) => s.status === "skipped").length,
    },
    breachedStepIds: breached.map((s) => s.id),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Advance: run next pending step with 2s delay, then mark success.
 * @param {string} workflowId
 * @returns {Promise<{ ok: boolean, error?: string, workflow?: ReturnType<typeof getPublicWorkflow> }>}
 */
export async function advanceNextStep(workflowId) {
  const w = workflows.get(workflowId);
  if (!w) {
    return { ok: false, error: "Workflow not found" };
  }
  if (w.runStatus !== "active") {
    return { ok: false, error: `Workflow is ${w.runStatus}` };
  }
  if (w.executionLocked) {
    return { ok: false, error: "A step is currently executing" };
  }
  if (w.nextStepIndex >= w.steps.length) {
    return { ok: false, error: "No more steps to execute" };
  }

  const step = w.steps[w.nextStepIndex];
  if (step.status !== "pending") {
    return { ok: false, error: "Current step is not pending" };
  }

  w.executionLocked = true;
  w.executionEpoch += 1;
  const epoch = w.executionEpoch;
  const start = new Date();
  step.status = "running";
  step.startTime = start.toISOString();
  step.endTime = null;
  step.duration = null;

  appendStepLog(step, `Agent ${step.assignedAgent} started ${step.id}`, {
    level: "info",
  });
  pushAudit(w, "step.started", {
    workflowId: w.id,
    stepId: step.id,
    assignedAgent: step.assignedAgent,
  });
  emit(w);

  const stepIndex = w.nextStepIndex;

  try {
    const orch = await orchestrateStepWithGroq(w, stepIndex);
    if (orch) {
      pushAudit(w, "orchestration.hint", {
        agent: "OrchestratorAgent",
        coordinationNote: orch.coordinationNote,
        watchouts: orch.watchouts,
      });
      emit(w);
    }
  } catch (e) {
    console.warn("[orchestrator] skipped:", e instanceof Error ? e.message : e);
  }

  setTimeout(() => {
    const current = workflows.get(workflowId);
    if (!current || current.executionEpoch !== epoch) {
      return;
    }
    if (current.runStatus !== "active") {
      return;
    }
    const s = current.steps[stepIndex];
    if (!s || s.status !== "running") {
      return;
    }
    completeStepSuccess(current, stepIndex);
    emit(current);
  }, STEP_EXECUTION_DELAY_MS);

  return { ok: true, workflow: getPublicWorkflow(w) };
}

const VALID_FAILURE_TYPES = new Set(["transient", "dependency", "hard"]);

/**
 * @param {Workflow} w
 * @param {{ index: number, phase: 'running' | 'pending' }} target
 */
function executeHardFailure(w, target) {
  const step = w.steps[target.index];
  const end = new Date();
  if (target.phase === "running") {
    step.status = "failed";
    step.endTime = end.toISOString();
    step.duration = step.startTime
      ? Math.round((end.getTime() - new Date(step.startTime).getTime()) / 1000)
      : 0;
  } else {
    step.status = "failed";
    step.startTime = step.startTime ?? end.toISOString();
    step.endTime = end.toISOString();
    step.duration = 0;
  }
  appendStepLog(
    step,
    `Step ${step.id} failed critically (hard failure policy)`,
    { level: "error" }
  );
  pushAudit(w, "step.failed", {
    workflowId: w.id,
    stepId: step.id,
    phase: target.phase,
    failureType: "hard",
  });
  w.executionLocked = false;
  w.escalationMessage = `Step ${step.id} failed critically. Human review required.`;
  appendStepLog(step, w.escalationMessage, { level: "error" });
  w.runStatus = "escalated";
  pushAudit(w, "workflow.escalated", {
    workflowId: w.id,
    stepId: step.id,
    message: w.escalationMessage,
  });
  emit(w);
  return { ok: true, workflow: getPublicWorkflow(w) };
}

/**
 * @param {Workflow} w
 * @param {{ index: number, phase: 'running' | 'pending' }} target
 */
function executeDependencySkip(w, target) {
  const step = w.steps[target.index];
  const end = new Date();
  if (target.phase === "running") {
    step.endTime = end.toISOString();
    step.duration = step.startTime
      ? Math.round((end.getTime() - new Date(step.startTime).getTime()) / 1000)
      : 0;
  } else {
    step.startTime = step.startTime ?? end.toISOString();
    step.endTime = end.toISOString();
    step.duration = 0;
  }
  step.status = "skipped";
  appendStepLog(
    step,
    "Skipped due to dependency failure, will revisit",
    { level: "warn" }
  );
  pushAudit(w, "step.skipped", {
    workflowId: w.id,
    stepId: step.id,
    reason: "dependency",
  });
  w.nextStepIndex = target.index + 1;
  w.executionLocked = false;
  if (w.nextStepIndex >= w.steps.length) {
    w.runStatus = "completed";
    pushAudit(w, "workflow.completed", { workflowId: w.id });
  }
  emit(w);
  return { ok: true, workflow: getPublicWorkflow(w) };
}

/**
 * @param {Workflow} w
 * @param {{ index: number, phase: 'running' | 'pending' }} target
 * @param {number} recoverySid
 * @param {boolean} transientAllRetriesFail
 */
function executeTransientRecoveryEntry(
  w,
  target,
  recoverySid,
  transientAllRetriesFail
) {
  const step = w.steps[target.index];
  const end = new Date();
  if (target.phase === "running") {
    step.status = "failed";
    step.endTime = end.toISOString();
    step.duration = step.startTime
      ? Math.round((end.getTime() - new Date(step.startTime).getTime()) / 1000)
      : 0;
  } else {
    step.status = "failed";
    step.startTime = step.startTime ?? end.toISOString();
    step.endTime = end.toISOString();
    step.duration = 0;
  }
  appendStepLog(step, "Transient failure reported; automated retries scheduled", {
    level: "warn",
  });
  pushAudit(w, "step.failed", {
    workflowId: w.id,
    stepId: step.id,
    phase: target.phase,
    failureType: "transient",
  });
  w.executionLocked = true;
  emit(w);
  scheduleTransientRecovery(w.id, target.index, transientAllRetriesFail, recoverySid);
  return { ok: true, workflow: getPublicWorkflow(w) };
}

/**
 * @param {string} workflowId
 * @param {{ failureType: FailureType, transientAllRetriesFail?: boolean }} options
 * @returns {Promise<{ ok: boolean, error?: string, workflow?: ReturnType<typeof getPublicWorkflow> }>}
 */
export async function failCurrentStep(workflowId, options) {
  const failureType = options?.failureType;
  if (!failureType || !VALID_FAILURE_TYPES.has(failureType)) {
    return {
      ok: false,
      error:
        "Invalid or missing failureType; expected 'transient', 'dependency', or 'hard'",
    };
  }

  const transientAllRetriesFail =
    Boolean(options?.transientAllRetriesFail) ||
    process.env.AUTOOPS_TRANSIENT_ALL_FAIL === "1";

  const w = workflows.get(workflowId);
  if (!w) {
    return { ok: false, error: "Workflow not found" };
  }
  if (w.runStatus !== "active") {
    return { ok: false, error: `Workflow is ${w.runStatus}` };
  }

  w.executionEpoch += 1;
  w.recoverySessionId += 1;
  const recoverySid = w.recoverySessionId;

  const target = findFailTarget(w);
  if (!target) {
    return { ok: false, error: "No current step to fail" };
  }

  const step = w.steps[target.index];

  let resolved;
  try {
    const llm = await decideRecoveryWithGroq({
      workflow: w,
      target,
      step,
      operatorHint: failureType,
    });
    resolved = llm ?? fallbackRecoveryFromOperatorHint(failureType);
  } catch (e) {
    console.warn("[decision-agent] Groq failed:", e instanceof Error ? e.message : e);
    resolved = fallbackRecoveryFromOperatorHint(failureType);
  }

  pushRecoveryDecisionLLM(w, resolved);

  switch (resolved.decision) {
    case "ESCALATE":
      return executeHardFailure(w, target);
    case "SKIP":
      return executeDependencySkip(w, target);
    case "RETRY":
      return executeTransientRecoveryEntry(
        w,
        target,
        recoverySid,
        transientAllRetriesFail
      );
    default:
      return executeHardFailure(w, target);
  }
}

/**
 * @param {Workflow} workflow
 * @param {string} stepName
 * @returns {number}
 */
function findStepIndexByName(workflow, stepName) {
  return workflow.steps.findIndex((s) => s.id === stepName);
}

/**
 * @param {string} workflowId
 * @param {{ stepName: string, action: string, attempts: number, waitSeconds: number, reasoning: string, confidence: number }} body
 * @returns {{ ok: true, workflow: ReturnType<typeof getPublicWorkflow> } | { ok: false, error: string }}
 */
export function applyWorkflowRetry(workflowId, body) {
  const w = workflows.get(workflowId);
  if (!w) {
    return { ok: false, error: "Workflow not found" };
  }
  if (w.runStatus !== "active") {
    return { ok: false, error: `Workflow is ${w.runStatus}` };
  }
  const stepIdx = findStepIndexByName(w, body.stepName);
  if (stepIdx === -1) {
    return { ok: false, error: "Step not found" };
  }

  const step = w.steps[stepIdx];
  const okStatus =
    step.status === "pending" ||
    step.status === "running" ||
    step.status === "failed" ||
    step.status === "retrying";
  if (!okStatus) {
    return { ok: false, error: "Step is not eligible for retry" };
  }
  step.status = "retrying";
  w.executionLocked = false;
  w.executionEpoch += 1;
  const epoch = w.executionEpoch;

  const ts = new Date().toISOString();
  pushAudit(w, "decision.retry.initiated", {
    timestamp: ts,
    agent: "DecisionAgent",
    action: "RETRY_INITIATED",
    result: "retrying",
    reasoning: body.reasoning,
    confidence: body.confidence,
    attempts: body.attempts,
    requestAction: body.action,
    stepName: body.stepName,
  });
  emit(w);

  const waitMs = Math.max(0, Math.floor(Number(body.waitSeconds) * 1000)) || 0;

  setTimeout(() => {
    const cur = workflows.get(workflowId);
    if (!cur || cur.executionEpoch !== epoch) {
      return;
    }
    const s = cur.steps[stepIdx];
    if (!s || s.status !== "retrying") {
      return;
    }
    const ws = Math.max(0, Math.floor(Number(body.waitSeconds)));
    s.startTime = new Date(Date.now() - ws * 1000).toISOString();
    completeStepSuccess(cur, stepIdx);
    const ts2 = new Date().toISOString();
    pushAudit(cur, "decision.retry.success", {
      timestamp: ts2,
      agent: "DecisionAgent",
      action: "RETRY_SUCCESS",
      result: "success",
      reasoning: "Step recovered after retry attempt",
      confidence: 0.95,
      stepName: body.stepName,
    });
    emit(cur);
  }, waitMs);

  return { ok: true, workflow: getPublicWorkflow(w) };
}

/**
 * @param {unknown[]} orderIds
 * @param {Workflow["steps"]} pendingSteps
 * @returns {Workflow["steps"]}
 */
function reorderPendingSteps(orderIds, pendingSteps) {
  const byId = new Map(pendingSteps.map((s) => [s.id, s]));
  const out = [];
  for (const id of orderIds) {
    if (typeof id !== "string") continue;
    const step = byId.get(id);
    if (step) {
      out.push(step);
      byId.delete(id);
    }
  }
  for (const s of byId.values()) {
    out.push(s);
  }
  return out;
}

/**
 * @param {string} workflowId
 * @param {{ stepName: string, action: string, skipStep: boolean, newOrder: unknown, reasoning: string, confidence: number }} body
 * @returns {{ ok: true, workflow: ReturnType<typeof getPublicWorkflow> } | { ok: false, error: string }}
 */
export function applyWorkflowReorder(workflowId, body) {
  const w = workflows.get(workflowId);
  if (!w) {
    return { ok: false, error: "Workflow not found" };
  }
  if (w.runStatus !== "active") {
    return { ok: false, error: `Workflow is ${w.runStatus}` };
  }

  let orderIds;
  if (Array.isArray(body.newOrder)) {
    orderIds = body.newOrder;
  } else if (typeof body.newOrder === "string") {
    try {
      const parsed = JSON.parse(body.newOrder);
      orderIds = Array.isArray(parsed) ? parsed : null;
    } catch {
      return { ok: false, error: "Invalid newOrder JSON" };
    }
  } else {
    return { ok: false, error: "newOrder must be a JSON string or array" };
  }
  if (!orderIds || !Array.isArray(orderIds)) {
    return { ok: false, error: "newOrder must parse to an array" };
  }

  const skipIdx = findStepIndexByName(w, body.stepName);
  if (skipIdx === -1) {
    return { ok: false, error: "Step not found" };
  }
  const skipStep = w.steps[skipIdx];
  if (skipIdx !== w.nextStepIndex || skipStep.status !== "pending") {
    return { ok: false, error: "stepName must be the current pending step" };
  }
  const end = new Date();
  skipStep.status = "skipped";
  skipStep.startTime = skipStep.startTime ?? end.toISOString();
  skipStep.endTime = end.toISOString();
  skipStep.duration = skipStep.startTime
    ? Math.round(
        (end.getTime() - new Date(skipStep.startTime).getTime()) / 1000
      )
    : 0;
  appendStepLog(
    skipStep,
    "Skipped for dependency reorder",
    { level: "warn" }
  );
  pushAudit(w, "step.skipped", {
    workflowId: w.id,
    stepId: skipStep.id,
    reason: "dependency_reorder",
  });

  const rest = w.steps.slice(skipIdx + 1);
  const pendingInRest = rest.filter((s) => s.status === "pending");
  const nonPendingInRest = rest.filter((s) => s.status !== "pending");
  const reorderedPending = reorderPendingSteps(orderIds, pendingInRest);

  w.steps = [
    ...w.steps.slice(0, skipIdx + 1),
    ...reorderedPending,
    ...nonPendingInRest,
  ];

  w.nextStepIndex = skipIdx + 1;
  w.executionLocked = false;
  w.executionEpoch += 1;

  const ts = new Date().toISOString();
  pushAudit(w, "decision.dependency.reorder", {
    timestamp: ts,
    agent: "DecisionAgent",
    action: "DEPENDENCY_REORDER",
    result: "success",
    reasoning: body.reasoning,
    confidence: body.confidence,
    requestAction: body.action,
    skipStep: body.skipStep,
    stepName: body.stepName,
  });
  emit(w);

  const ts2 = new Date().toISOString();
  pushAudit(w, "decision.workflow.resumed", {
    timestamp: ts2,
    agent: "DecisionAgent",
    action: "WORKFLOW_RESUMED",
    result: "success",
    reasoning: "Workflow resumed after dependency reorder",
    confidence: 0.95,
  });
  emit(w);

  return { ok: true, workflow: getPublicWorkflow(w) };
}

/**
 * @param {string} workflowId
 * @param {{ stepName: string, action: string, message: string, urgency: string, affectedStep: string, recommendedAction: string, reasoning: string, confidence: number }} body
 * @returns {{ ok: true, workflow: ReturnType<typeof getPublicWorkflow> } | { ok: false, error: string }}
 */
export function applyWorkflowEscalate(workflowId, body) {
  const w = workflows.get(workflowId);
  if (!w) {
    return { ok: false, error: "Workflow not found" };
  }
  if (w.runStatus !== "active") {
    return { ok: false, error: `Workflow is ${w.runStatus}` };
  }

  const stepIdx = findStepIndexByName(w, body.stepName);
  if (stepIdx === -1) {
    return { ok: false, error: "Step not found" };
  }

  const step = w.steps[stepIdx];
  const now = new Date().toISOString();
  step.status = "escalated";
  step.endTime = now;
  step.startTime = step.startTime ?? now;
  step.duration = 0;
  appendStepLog(step, body.message, { level: "error" });

  w.runStatus = "escalated";
  w.executionLocked = false;
  w.escalationMessage = body.message;
  w.executionEpoch += 1;

  escalations[workflowId] = {
    workflowId,
    message: body.message,
    urgency: body.urgency,
    affectedStep: body.affectedStep,
    recommendedAction: body.recommendedAction,
    reasoning: body.reasoning,
    escalatedAt: now,
  };

  const ts = new Date().toISOString();
  pushAudit(w, "decision.hard_failure.escalated", {
    timestamp: ts,
    agent: "DecisionAgent",
    action: "HARD_FAILURE_ESCALATED",
    result: "escalated",
    reasoning: body.reasoning,
    confidence: body.confidence,
    requestAction: body.action,
    stepName: body.stepName,
  });
  emit(w);

  const ts2 = new Date().toISOString();
  pushAudit(w, "orchestrator.workflow.paused", {
    timestamp: ts2,
    agent: "OrchestratorAgent",
    action: "WORKFLOW_PAUSED",
    result: "escalated",
    reasoning: `Workflow paused pending human intervention: ${body.message}`,
    confidence: 0.99,
  });
  emit(w);

  return { ok: true, workflow: getPublicWorkflow(w) };
}

/**
 * @returns {{ escalations: typeof escalations extends Record<string, infer V> ? V[] : never, count: number }}
 */
export function getAllEscalations() {
  const list = Object.values(escalations);
  return { escalations: list, count: list.length };
}
