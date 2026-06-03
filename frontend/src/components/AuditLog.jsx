import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { ENDPOINTS } from "../config/endpoints.js";

/** @param {string | undefined} stepId */
function agentFromStepId(stepId) {
  if (!stepId) return "MonitorAgent";
  if (stepId.startsWith("HR_")) return "HRAgent";
  if (stepId.startsWith("IT_")) return "ITAgent";
  if (stepId.startsWith("FINANCE_")) return "FinanceAgent";
  if (stepId.startsWith("COMPLIANCE_") || stepId.startsWith("MANAGER_"))
    return "MonitorAgent";
  return "MonitorAgent";
}

/** @param {string | undefined} assigned */
function agentFromAssigned(assigned) {
  if (!assigned) return "MonitorAgent";
  if (assigned.includes("hr")) return "HRAgent";
  if (assigned.includes("it-") || assigned.includes("identity") || assigned.includes("provisioning"))
    return "ITAgent";
  if (assigned.includes("finance") || assigned.includes("payroll"))
    return "FinanceAgent";
  if (assigned.includes("compliance") || assigned.includes("manager"))
    return "MonitorAgent";
  return "MonitorAgent";
}

/**
 * @param {object} ev
 * @returns {{ time: string, agent: string, action: string, result: string, reasoning: string, confidence: string, rowTone: 'success' | 'failed' | 'retry' | 'escalated' | 'neutral' }}
 */
function rowFromEvent(ev) {
  const p = ev.payload && typeof ev.payload === "object" ? ev.payload : {};
  const type = ev.type || "";

  let agent = "MonitorAgent";
  let result = "—";
  let reasoning = "";
  let confidence = "";
  let rowTone = /** @type {'success' | 'failed' | 'retry' | 'escalated' | 'neutral'} */ (
    "neutral"
  );

  if (type === "recovery.decision") {
    agent = "DecisionAgent";
    result = String(p.action ?? p.decision ?? "—");
    reasoning = String(p.reasoning ?? "");
    if (typeof p.confidence === "number") {
      confidence = p.confidence.toFixed(2);
    }
    const u = result.toUpperCase();
    rowTone = u.includes("RETRY")
      ? "retry"
      : u.includes("ESCALATE")
        ? "escalated"
        : "neutral";
  } else if (type === "orchestration.hint") {
    agent = "OrchestratorAgent";
    result = "Coordination hint";
    reasoning = [p.coordinationNote, p.watchouts].filter(Boolean).join(" · ");
  } else if (type === "step.started") {
    agent = agentFromAssigned(p.assignedAgent) || agentFromStepId(p.stepId);
    result = "Started";
    reasoning = p.stepId ? String(p.stepId) : "";
  } else if (type === "step.completed") {
    agent = agentFromStepId(p.stepId);
    result = "Success";
    reasoning = p.durationSeconds != null ? `${p.durationSeconds}s elapsed` : "";
    rowTone = "success";
  } else if (type === "step.failed") {
    agent = agentFromStepId(p.stepId);
    result = "Failed";
    reasoning = p.failureType ? String(p.failureType) : "";
    rowTone = "failed";
  } else if (type === "step.skipped") {
    agent = agentFromStepId(p.stepId);
    result = "Skipped";
    reasoning = p.reason ? String(p.reason) : "";
    rowTone = "retry";
  } else if (type === "workflow.escalated") {
    agent = "DecisionAgent";
    result = "Escalated";
    reasoning = p.message ? String(p.message) : "";
    rowTone = "escalated";
  } else if (type === "workflow.completed") {
    agent = "OrchestratorAgent";
    result = "Complete";
    rowTone = "success";
  } else if (type === "workflow.created") {
    agent = "MonitorAgent";
    result = "Created";
  } else {
    reasoning = JSON.stringify(p).slice(0, 200);
  }

  return {
    time: ev.at
      ? new Date(ev.at).toLocaleString()
      : "—",
    agent,
    action: type,
    result,
    reasoning,
    confidence,
    rowTone,
  };
}

const TONE_ROW = {
  success: "bg-emerald-950/25 border-l-2 border-emerald-500/70",
  failed: "bg-red-950/25 border-l-2 border-red-500/70",
  retry: "bg-yellow-950/20 border-l-2 border-yellow-500/60",
  escalated: "bg-orange-950/25 border-l-2 border-orange-500/70",
  neutral: "bg-[#0f1117]/60 border-l-2 border-transparent",
};

/** @param {{ workflowId: string | null }} props */
export function AuditLog({ workflowId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(
    /** @type {'all' | 'failures' | 'escalations' | 'recoveries'} */ ("all")
  );

  useEffect(() => {
    if (!workflowId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(ENDPOINTS.workflowAudit(workflowId));
        if (!res.ok) throw new Error("Audit fetch failed");
        const data = await res.json();
        if (!cancelled) setEvents(data.events || []);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const rows = useMemo(() => {
    return events.map((ev) => ({ ev, ...rowFromEvent(ev) }));
  }, [events]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "failures") {
      return rows.filter(
        (r) => r.ev.type === "step.failed" || r.rowTone === "failed"
      );
    }
    if (filter === "escalations") {
      return rows.filter(
        (r) =>
          r.ev.type === "workflow.escalated" || r.rowTone === "escalated"
      );
    }
    if (filter === "recoveries") {
      return rows.filter(
        (r) =>
          r.ev.type === "recovery.decision" ||
          r.ev.type === "orchestration.hint" ||
          r.ev.type === "step.skipped"
      );
    }
    return rows;
  }, [rows, filter]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${workflowId ?? "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!workflowId) {
    return (
      <p className="text-sm text-gray-500">
        Select a workflow to view the audit trail.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
          <FileText className="h-4 w-4 text-violet-400" />
          Immutable audit trail
        </div>
        <button
          type="button"
          onClick={exportJson}
          disabled={!events.length}
          className="inline-flex items-center gap-1.5 rounded-lg border border-shell-border bg-shell-card px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Export JSON
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          /** @type {const} */ ([
            ["all", "All"],
            ["failures", "Failures"],
            ["escalations", "Escalations"],
            ["recoveries", "Recoveries"],
          ])
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === id
                ? "bg-cyan-900/50 text-cyan-100 ring-1 ring-cyan-700/50"
                : "bg-[#12141c] text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-shell-border">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-shell-border bg-[#12141c] text-[10px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">Reasoning</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ ev, time, agent, action, result, reasoning, confidence, rowTone }) => (
                <tr
                  key={ev.id}
                  className={`border-b border-shell-border/40 ${TONE_ROW[rowTone]}`}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                    {time}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-200">{agent}</td>
                  <td className="px-3 py-2 font-mono text-gray-400">{action}</td>
                  <td className="px-3 py-2 text-gray-300">{result}</td>
                  <td className="max-w-md px-3 py-2 text-gray-400">
                    <span className="line-clamp-3">{reasoning || "—"}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {confidence || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-600">
              No events for this filter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
