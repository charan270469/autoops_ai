import { Router } from "express";
import { analyzeTranscriptWithGroq } from "../meetingGroq.js";
import {
  getMeetingAnalysisBatches,
  getStoredMeetingTasks,
  persistMeetingAnalysis,
} from "../meetingStore.js";

/** @type {Record<string, unknown>[]} */
const meetingTasks = [];

/** @type {Array<{ timestamp: string, agent: string, action: string, result: string, reasoning: string, confidence: number }>} */
const meetingAuditTrail = [];

/**
 * @param {unknown} tasksInput
 * @param {string} source
 * @returns {Record<string, unknown>[]}
 */
function normalizeIncomingTasks(tasksInput, source) {
  let rawItems;
  if (Array.isArray(tasksInput)) {
    rawItems = tasksInput;
  } else if (typeof tasksInput === "string") {
    try {
      const parsed = JSON.parse(tasksInput);
      rawItems = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rawItems = [tasksInput];
    }
  } else {
    return [];
  }

  const baseTs = Date.now();
  return rawItems.map((item, index) => {
    const obj =
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? { ...item }
        : { task: String(item) };
    return {
      ...obj,
      id: `task_${baseTs}_${index}`,
      status: "pending",
      createdAt: new Date().toISOString(),
      source,
    };
  });
}

/**
 * @param {{ broadcast?: (payload: unknown) => void }} [options]
 */
export function createMeetingRouter(options = {}) {
  const broadcast = options.broadcast ?? (() => {});

  const router = Router();

  router.post("/tasks", (req, res) => {
    const { tasks: tasksInput, source } = req.body ?? {};
    if (typeof source !== "string") {
      res.status(400).json({ error: 'Expected "source" (string) in body' });
      return;
    }
    if (!Array.isArray(tasksInput) && typeof tasksInput !== "string") {
      res
        .status(400)
        .json({ error: 'Expected "tasks" (JSON string or array) in body' });
      return;
    }
    const parsedTasks = normalizeIncomingTasks(tasksInput, source);
    for (const t of parsedTasks) {
      meetingTasks.push(t);
    }
    const ts = new Date().toISOString();
    meetingAuditTrail.push({
      timestamp: ts,
      agent: "MeetingIntelligenceAgent",
      action: "TASKS_EXTRACTED",
      result: "success",
      reasoning: `${parsedTasks.length} tasks extracted from meeting transcript via n8n`,
      confidence: 0.92,
    });
    broadcast({
      type: "MEETING_TASKS_RECEIVED",
      tasks: parsedTasks,
      count: parsedTasks.length,
    });
    res.json({
      success: true,
      tasks: parsedTasks,
      count: parsedTasks.length,
    });
  });

  router.get("/tasks", (_req, res) => {
    if (meetingTasks.length === 0) {
      res.json({ tasks: [], count: 0 });
      return;
    }
    res.json({
      tasks: meetingTasks.map((t) => ({ ...t })),
      count: meetingTasks.length,
    });
  });

  router.patch("/tasks/:taskId", (req, res) => {
    const { status } = req.body ?? {};
    if (status !== "completed") {
      res.status(400).json({ error: 'Body must be { "status": "completed" }' });
      return;
    }
    const task = meetingTasks.find((t) => t.id === req.params.taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    task.status = status;
    task.completedAt = new Date().toISOString();
    res.json({ ...task });
  });

  /** Prior analyze-flow dashboard: tasks + batches from meetingStore */
  router.get("/analysis-store", (_req, res) => {
    res.json({
      tasks: getStoredMeetingTasks(),
      batches: getMeetingAnalysisBatches(),
    });
  });

  router.post("/analyze", async (req, res) => {
    const transcript = req.body?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) {
      res.status(400).json({
        error: 'Request body must include a non-empty string "transcript".',
      });
      return;
    }

    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      res.status(503).json({
        error:
          "GROQ_API_KEY is not set. Configure it in the environment before calling meeting analysis.",
      });
      return;
    }

    try {
      const result = await analyzeTranscriptWithGroq(transcript, apiKey);

      if (result.source !== "cache") {
        persistMeetingAnalysis(result.tasks, {
          summary: result.summary,
          totalTasks: result.totalTasks,
          highPriorityCount: result.highPriorityCount,
          source: result.source,
        });
      }

      res.json({
        tasks: result.tasks,
        summary: result.summary,
        totalTasks: result.totalTasks,
        highPriorityCount: result.highPriorityCount,
        source: result.source,
      });
    } catch (e) {
      const status = /** @type {{ status?: number }} */ (e).status ?? 502;
      res.status(status >= 400 ? status : 502).json({
        error: e instanceof Error ? e.message : "Meeting analysis failed",
      });
    }
  });

  return router;
}
