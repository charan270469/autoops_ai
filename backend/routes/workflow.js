import { Router } from "express";
import {
  advanceNextStep,
  applyWorkflowEscalate,
  applyWorkflowReorder,
  applyWorkflowRetry,
  createWorkflow,
  failCurrentStep,
  getAllEscalations,
  getAuditTrail,
  getHealth,
  getPublicWorkflow,
  getWorkflowById,
  recordN8nPlanReceived,
} from "../workflowEngine.js";

/** @type {Record<string, { workflowId: string, employeeName: string, department: string, plan: unknown, receivedAt: string }>} */
const n8nPlans = Object.create(null);

/**
 * @param {{ broadcast?: (payload: unknown) => void }} [options]
 */
export function createWorkflowRouter(options = {}) {
  const broadcast = options.broadcast ?? (() => {});

  const router = Router();

  router.post("/n8n-plan", (req, res) => {
    const { workflowId, employeeName, department, plan } = req.body ?? {};
    if (
      typeof workflowId !== "string" ||
      typeof employeeName !== "string" ||
      typeof department !== "string" ||
      typeof plan !== "string"
    ) {
      res.status(400).json({
        error:
          "Expected workflowId, employeeName, department, and plan (string) in body",
      });
      return;
    }
    let parsedPlan;
    try {
      parsedPlan = JSON.parse(plan);
    } catch {
      res.status(400).json({ error: "plan must be valid JSON" });
      return;
    }
    const receivedAt = new Date().toISOString();
    n8nPlans[workflowId] = {
      workflowId,
      employeeName,
      department,
      plan: parsedPlan,
      receivedAt,
    };
    recordN8nPlanReceived(workflowId);
    broadcast({
      type: "N8N_PLAN_RECEIVED",
      workflowId,
      employeeName,
      plan: parsedPlan,
    });
    res.json({
      success: true,
      workflowId,
      message: "Plan received and stored",
    });
  });

  router.get("/n8n-plan/:workflowId", (req, res) => {
    const entry = n8nPlans[req.params.workflowId];
    if (!entry) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    res.json(entry);
  });

  router.post("/retry", (req, res) => {
    const b = req.body ?? {};
    if (typeof b.workflowId !== "string" || typeof b.stepName !== "string") {
      res.status(400).json({ error: "workflowId and stepName are required" });
      return;
    }
    const result = applyWorkflowRetry(b.workflowId, {
      stepName: b.stepName,
      action: typeof b.action === "string" ? b.action : "",
      attempts: Number(b.attempts) || 0,
      waitSeconds: Number(b.waitSeconds) || 0,
      reasoning: typeof b.reasoning === "string" ? b.reasoning : "",
      confidence: Number(b.confidence) || 0,
    });
    if (!result.ok) {
      res
        .status(result.error === "Workflow not found" ? 404 : 400)
        .json({ error: result.error });
      return;
    }
    res.json({
      success: true,
      workflowId: b.workflowId,
      action: "RETRY_INITIATED",
    });
  });

  router.post("/reorder", (req, res) => {
    const b = req.body ?? {};
    if (typeof b.workflowId !== "string" || typeof b.stepName !== "string") {
      res.status(400).json({ error: "workflowId and stepName are required" });
      return;
    }
    const result = applyWorkflowReorder(b.workflowId, {
      stepName: b.stepName,
      action: typeof b.action === "string" ? b.action : "",
      skipStep: Boolean(b.skipStep),
      newOrder: b.newOrder,
      reasoning: typeof b.reasoning === "string" ? b.reasoning : "",
      confidence: Number(b.confidence) || 0,
    });
    if (!result.ok) {
      const st =
        result.error === "Workflow not found"
          ? 404
          : result.error === "Invalid newOrder JSON" ||
              result.error?.includes("newOrder")
            ? 400
            : 400;
      res.status(st).json({ error: result.error });
      return;
    }
    res.json({
      success: true,
      workflowId: b.workflowId,
      action: "DEPENDENCY_REORDER",
    });
  });

  router.post("/escalate", (req, res) => {
    const b = req.body ?? {};
    if (typeof b.workflowId !== "string" || typeof b.stepName !== "string") {
      res.status(400).json({ error: "workflowId and stepName are required" });
      return;
    }
    const result = applyWorkflowEscalate(b.workflowId, {
      stepName: b.stepName,
      action: typeof b.action === "string" ? b.action : "",
      message: typeof b.message === "string" ? b.message : "",
      urgency: typeof b.urgency === "string" ? b.urgency : "",
      affectedStep: typeof b.affectedStep === "string" ? b.affectedStep : "",
      recommendedAction:
        typeof b.recommendedAction === "string" ? b.recommendedAction : "",
      reasoning: typeof b.reasoning === "string" ? b.reasoning : "",
      confidence: Number(b.confidence) || 0,
    });
    if (!result.ok) {
      res
        .status(result.error === "Workflow not found" ? 404 : 400)
        .json({ error: result.error });
      return;
    }
    broadcast({
      type: "WORKFLOW_ESCALATED",
      workflowId: b.workflowId,
      message: b.message,
      urgency: b.urgency,
      affectedStep: b.affectedStep,
      recommendedAction: b.recommendedAction,
    });
    res.json({
      success: true,
      workflowId: b.workflowId,
      action: "ESCALATED",
      message: b.message,
      urgency: b.urgency,
    });
  });

  router.get("/escalations", (_req, res) => {
    res.json(getAllEscalations());
  });

  router.post("/start", (_req, res) => {
    const workflow = createWorkflow();
    res.status(201).json({
      workflowId: workflow.id,
      workflow: getPublicWorkflow(workflow),
    });
  });

  router.get("/:id", (req, res) => {
    const w = getWorkflowById(req.params.id);
    if (!w) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(getPublicWorkflow(w));
  });

  router.post("/:id/next", async (req, res) => {
    const result = await advanceNextStep(req.params.id);
    if (!result.ok) {
      res.status(result.error === "Workflow not found" ? 404 : 400).json({
        error: result.error,
      });
      return;
    }
    res.json(result.workflow);
  });

  router.post("/:id/fail", async (req, res) => {
    const result = await failCurrentStep(req.params.id, {
      failureType: req.body?.failureType,
      transientAllRetriesFail: req.body?.transientAllRetriesFail === true,
    });
    if (!result.ok) {
      const status =
        result.error === "Workflow not found"
          ? 404
          : 400;
      res.status(status).json({
        error: result.error,
      });
      return;
    }
    res.json(result.workflow);
  });

  router.get("/:id/audit", (req, res) => {
    const w = getWorkflowById(req.params.id);
    if (!w) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json({
      workflowId: w.id,
      events: getAuditTrail(req.params.id),
    });
  });

  router.get("/:id/health", (req, res) => {
    const health = getHealth(req.params.id);
    if (!health.found) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(health);
  });

  return router;
}
