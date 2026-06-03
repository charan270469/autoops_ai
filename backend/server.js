import "./env-bootstrap.js";
import http from "http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { createMeetingRouter } from "./routes/meeting.js";
import { createWorkflowRouter } from "./routes/workflow.js";
import { subscribeWorkflowChange } from "./workflowEngine.js";

const PORT = 3001;
const app = express();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "autoops-ai-backend" });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

/** @type {import('ws').WebSocket[]} */
const clients = [];

/** @param {unknown} payload */
function broadcastWs(payload) {
  const payloadStr = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payloadStr);
    }
  }
}

wss.on("connection", (ws) => {
  clients.push(ws);
  ws.on("close", () => {
    const i = clients.indexOf(ws);
    if (i !== -1) clients.splice(i, 1);
  });
});

app.use(
  "/api/workflow",
  createWorkflowRouter({ broadcast: broadcastWs })
);
app.use(
  "/api/meeting",
  createMeetingRouter({ broadcast: broadcastWs })
);

function broadcastWorkflowState(workflow) {
  const payload = JSON.stringify({ type: "workflow:update", workflow });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

subscribeWorkflowChange(broadcastWorkflowState);

server.listen(PORT, () => {
  console.log(`AutoOps AI backend listening on http://localhost:${PORT}`);
});
