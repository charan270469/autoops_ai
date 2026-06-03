import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu,
  Plus,
  LayoutDashboard,
  Mic2,
  ScrollText,
  Wifi,
  WifiOff,
  HeartPulse,
  Trash2,
} from "lucide-react";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { workflowStatusLabel } from "./hooks/useWorkflow.js";
import { ENDPOINTS } from "./config/endpoints.js";
import {
  loadAllWorkflowIds,
  loadActiveWorkflowId,
  saveActiveWorkflowId,
  saveAllWorkflowIds,
  clearWorkflowStorage,
} from "./lib/workflowPersistence.js";
import { WorkflowPanel } from "./components/WorkflowPanel.jsx";
import { AgentFeed } from "./components/AgentFeed.jsx";
import { AuditLog } from "./components/AuditLog.jsx";
import { MeetingIntelligence } from "./components/MeetingIntelligence.jsx";
import { HealthMonitor } from "./components/HealthMonitor.jsx";

let feedSeq = 0;

/**
 * @param {import('react').Dispatch<import('react').SetStateAction<any[]>>} setFeed
 * @param {{ agent: string, message: string, confidence?: number }} item
 */
function pushFeedItem(setFeed, item) {
  feedSeq += 1;
  const id = `f-${feedSeq}-${Date.now()}`;
  const ts = Date.now();
  setFeed((prev) =>
    [{ id, agent: item.agent, message: item.message, ts, confidence: item.confidence }, ...prev].slice(
      0,
      20
    )
  );
}

/** @param {string | undefined} stepId */
function mapStepIdToAgentName(stepId) {
  if (!stepId) return "MonitorAgent";
  if (stepId.startsWith("HR_")) return "HRAgent";
  if (stepId.startsWith("IT_")) return "ITAgent";
  if (stepId.startsWith("FINANCE_")) return "FinanceAgent";
  if (stepId.startsWith("COMPLIANCE_") || stepId.startsWith("MANAGER_"))
    return "MonitorAgent";
  return "MonitorAgent";
}

/**
 * @param {object} wf
 * @returns {{ agent: string, message: string, confidence?: number }}
 */
function feedFromWorkflowSnapshot(wf) {
  if (wf.escalationMessage) {
    return {
      agent: "DecisionAgent",
      message: String(wf.escalationMessage),
    };
  }
  if (wf.runStatus === "completed") {
    return {
      agent: "OrchestratorAgent",
      message: "Workflow completed successfully.",
    };
  }
  const running = wf.steps?.find((s) => s.status === "running");
  if (running) {
    return {
      agent: mapStepIdToAgentName(running.id),
      message: `${running.id} → ${running.status} (${running.assignedAgent})`,
    };
  }
  return {
    agent: "MonitorAgent",
    message: `Workflow ${wf.runStatus} · next step index ${wf.nextStepIndex}`,
  };
}

function computeAutonomy(snapshot) {
  if (!snapshot?.steps?.length) return null;
  const ok = snapshot.steps.filter((s) => s.status === "success").length;
  return Math.round((ok / snapshot.steps.length) * 100);
}

function sidebarDotClass(snapshot) {
  if (!snapshot) return "bg-gray-600";
  const label = workflowStatusLabel(snapshot);
  if (label === "completed") return "bg-emerald-500";
  if (label === "escalated") return "bg-orange-500";
  if (label === "failed") return "bg-red-500";
  const running = snapshot.steps?.some((s) => s.status === "running");
  if (running) return "bg-blue-500 animate-pulse";
  return "bg-cyan-600/60";
}

function statusBadge(snapshot) {
  if (!snapshot) return { text: "…", className: "bg-gray-800 text-gray-400" };
  const rs = snapshot.runStatus;
  if (rs === "completed")
    return { text: "completed", className: "bg-emerald-950/60 text-emerald-300" };
  if (rs === "escalated")
    return { text: "escalated", className: "bg-orange-950/60 text-orange-200" };
  if (rs === "failed")
    return { text: "failed", className: "bg-red-950/60 text-red-300" };
  return { text: "active", className: "bg-slate-800 text-slate-300" };
}

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [allWorkflowIds, setAllWorkflowIds] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  /** @type {Record<string, object>} */
  const [snapshotsById, setSnapshotsById] = useState({});

  const [tab, setTab] = useState("workflow");
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [feed, setFeed] = useState([]);
  const [backendOk, setBackendOk] = useState(false);
  const [toast, setToast] = useState(
    /** @type {{ message: string, variant?: 'emerald' | 'blue' } | null} */ (null)
  );
  /** @type {Record<string, unknown>} */
  const [n8nOnboardingPlans, setN8nOnboardingPlans] = useState({});

  const mergeSnapshot = useCallback((id, snapshot) => {
    if (!id || !snapshot) return;
    setSnapshotsById((prev) => ({ ...prev, [id]: snapshot }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  /** Bootstrap: reload persistence or create first workflow */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = loadAllWorkflowIds();
      let active = loadActiveWorkflowId();

      if (all.length === 0) {
        try {
          const res = await fetch(ENDPOINTS.startWorkflow, {
            method: "POST",
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Start failed");
          if (cancelled) return;
          const id = data.workflowId;
          const snap = data.workflow;
          saveAllWorkflowIds([id]);
          saveActiveWorkflowId(id);
          setAllWorkflowIds([id]);
          setSelectedWorkflowId(id);
          setSnapshotsById({ [id]: snap });
        } catch (e) {
          console.error(e);
        } finally {
          if (!cancelled) setAppReady(true);
        }
        return;
      }

      setAllWorkflowIds(all);
      if (active && all.includes(active)) {
        setSelectedWorkflowId(active);
      } else {
        const pick = all[0];
        setSelectedWorkflowId(pick);
        saveActiveWorkflowId(pick);
      }

      const entries = await Promise.all(
        all.map(async (id) => {
          try {
            const r = await fetch(ENDPOINTS.workflowStatus(id));
            if (!r.ok) return [id, null];
            return [id, await r.json()];
          } catch {
            return [id, null];
          }
        })
      );
      if (cancelled) return;
      setSnapshotsById((prev) => {
        const next = { ...prev };
        for (const [id, snap] of entries) {
          if (snap) next[id] = snap;
        }
        return next;
      });
      setAppReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persist active selection */
  useEffect(() => {
    if (selectedWorkflowId) {
      saveActiveWorkflowId(selectedWorkflowId);
    }
  }, [selectedWorkflowId]);

  const onWsMessage = useCallback(
    (data) => {
      if (data?.type === "workflow:update" && data.workflow?.id) {
        const wf = data.workflow;
        mergeSnapshot(wf.id, wf);
        pushFeedItem(setFeed, feedFromWorkflowSnapshot(wf));
      }
    },
    [mergeSnapshot]
  );

  const { connected } = useWebSocket(onWsMessage);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(ENDPOINTS.healthz);
        setBackendOk(r.ok);
      } catch {
        setBackendOk(false);
      }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, []);

  const selectedSnapshot = selectedWorkflowId
    ? snapshotsById[selectedWorkflowId]
    : null;
  const autonomy = computeAutonomy(selectedSnapshot);

  const systemOk = backendOk && connected;

  const handleNewWorkflow = async () => {
    setBusy(true);
    try {
      const res = await fetch(ENDPOINTS.startWorkflow, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start workflow");
      const id = data.workflowId;
      const snap = data.workflow;
      setAllWorkflowIds((prev) => {
        const next = [...new Set([...prev, id])];
        saveAllWorkflowIds(next);
        return next;
      });
      setSelectedWorkflowId(id);
      saveActiveWorkflowId(id);
      mergeSnapshot(id, snap);
      pushFeedItem(setFeed, {
        agent: "MonitorAgent",
        message: `Created workflow ${id.slice(0, 8)}…`,
      });
      setTab("workflow");

      try {
        const n8nRes = await fetch(ENDPOINTS.n8nOnboarding, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "New Employee",
            department: "Engineering",
            employeeId: `EMP_${Date.now()}`,
          }),
        });
        if (n8nRes.ok) {
          const plan = await n8nRes.json().catch(() => null);
          if (plan != null) {
            setN8nOnboardingPlans((prev) => ({ ...prev, [id]: plan }));
            setToast({
              message: "Orchestration plan received from n8n",
              variant: "blue",
            });
          }
        }
      } catch {
        /* n8n optional */
      }
    } catch (e) {
      pushFeedItem(setFeed, {
        agent: "MonitorAgent",
        message: `Error: ${e instanceof Error ? e.message : "request failed"}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmClearAll = async () => {
    setConfirmClearOpen(false);
    setClearing(true);
    try {
      clearWorkflowStorage();
      setAllWorkflowIds([]);
      setSelectedWorkflowId(null);
      setSnapshotsById({});
      setFeed([]);

      const res = await fetch(ENDPOINTS.startWorkflow, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Start failed after clear");
      const id = data.workflowId;
      const snap = data.workflow;
      saveAllWorkflowIds([id]);
      saveActiveWorkflowId(id);
      setAllWorkflowIds([id]);
      setSelectedWorkflowId(id);
      setSnapshotsById({ [id]: snap });
      setTab("workflow");
      pushFeedItem(setFeed, {
        agent: "MonitorAgent",
        message: `Fresh workflow ${id.slice(0, 8)}… after clear.`,
      });
      setToast({ message: "All workflows cleared", variant: "emerald" });
    } catch (e) {
      console.error(e);
      pushFeedItem(setFeed, {
        agent: "MonitorAgent",
        message: `Clear failed: ${e instanceof Error ? e.message : "error"}`,
      });
    } finally {
      setClearing(false);
    }
  };

  const tabs = useMemo(
    () => [
      { id: "workflow", label: "Workflow", icon: LayoutDashboard },
      { id: "meeting", label: "Meeting intelligence", icon: Mic2 },
      { id: "audit", label: "Audit log", icon: ScrollText },
    ],
    []
  );

  if (!appReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1117] text-gray-400">
        Loading workflows…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0f1117] text-gray-100">
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-4 py-2 text-sm font-medium shadow-lg ${
            toast.variant === "blue"
              ? "border-blue-600/50 bg-blue-950/95 text-blue-100"
              : "border-emerald-700/50 bg-emerald-950/90 text-emerald-100"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      {confirmClearOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-dialog-title"
        >
          <div className="w-full max-w-md rounded-xl border border-shell-border bg-[#12141c] p-5 shadow-xl">
            <h2
              id="clear-dialog-title"
              className="text-base font-semibold text-white"
            >
              Clear all workflows?
            </h2>
            <p className="mt-2 text-sm text-gray-400">
              Are you sure you want to clear all workflows? This cannot be
              undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="rounded-lg border border-shell-border px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex h-14 shrink-0 items-center justify-between border-b border-shell-border bg-[#12141c] px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-800 shadow-lg shadow-cyan-900/30">
            <Cpu className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">
              AutoOps AI
            </h1>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Enterprise dashboard
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {autonomy != null && (
            <div
              className="hidden items-center gap-2 rounded-full border border-shell-border bg-shell-card px-3 py-1 sm:flex"
              title="Share of steps completed successfully"
            >
              <HeartPulse className="h-3.5 w-3.5 text-pink-400" />
              <span className="text-xs text-gray-400">Autonomy</span>
              <span className="text-sm font-semibold text-cyan-300">
                {autonomy}%
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full border border-shell-border bg-shell-card px-2.5 py-1">
            {systemOk ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-amber-500" />
            )}
            <span
              className={`text-xs font-medium ${
                systemOk ? "text-emerald-300" : "text-amber-300"
              }`}
            >
              {systemOk ? "Live" : "Degraded"}
            </span>
            <span
              className={`h-2 w-2 rounded-full ${
                systemOk ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
              }`}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-shell-border bg-[#12141c] lg:w-[280px] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-shell-border p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Workflows
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(true)}
                disabled={busy || clearing}
                className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-500/20 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {clearing ? "Clearing…" : "Clear"}
              </button>
              <button
                type="button"
                onClick={handleNewWorkflow}
                disabled={busy || clearing}
                className="inline-flex items-center gap-1 rounded-md bg-cyan-800/80 px-2 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-700 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-2">
            {allWorkflowIds.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-gray-600">
                No workflows. Click New.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {allWorkflowIds.map((wid) => {
                  const snap = snapshotsById[wid];
                  const isSelected = wid === selectedWorkflowId;
                  const badge = statusBadge(snap);
                  const created = snap?.createdAt
                    ? new Date(snap.createdAt).toLocaleString()
                    : "—";
                  return (
                    <li key={wid}>
                      <button
                        type="button"
                        onClick={() => setSelectedWorkflowId(wid)}
                        className={`w-full rounded-lg border px-2.5 py-2.5 text-left transition-colors ${
                          isSelected
                            ? "border-cyan-700/60 bg-[#1a1d2e] ring-1 ring-cyan-800/50"
                            : "border-transparent bg-transparent hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${sidebarDotClass(snap)}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[11px] text-gray-200">
                              {wid}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                              >
                                {badge.text}
                              </span>
                            </div>
                            <div className="mt-1 text-[10px] text-gray-500">
                              {created}
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[#0f1117]">
          <div className="flex shrink-0 gap-1 border-b border-shell-border px-2 pt-2">
            {tabs.map((t) => {
              const Icon = t.icon;
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                    on
                      ? "bg-shell-card text-white border border-b-0 border-shell-border"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <Icon className="h-4 w-4 opacity-80" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className={tab === "workflow" ? "block" : "hidden"}>
              <WorkflowPanel
                selectedWorkflowId={selectedWorkflowId}
                snapshot={selectedSnapshot}
                onMergeSnapshot={mergeSnapshot}
                wsConnected={connected}
                n8nOnboardingPlan={
                  selectedWorkflowId
                    ? n8nOnboardingPlans[selectedWorkflowId]
                    : undefined
                }
                onToast={(message) =>
                  setToast({ message, variant: "emerald" })
                }
              />
            </div>
            {tab === "meeting" && <MeetingIntelligence />}
            {tab === "audit" && (
              <AuditLog workflowId={selectedWorkflowId} />
            )}
          </div>
        </main>

        <aside className="flex max-h-[min(100vh,920px)] min-h-0 w-full shrink-0 flex-col border-t border-shell-border bg-[#12141c] lg:h-auto lg:w-[320px] lg:max-h-none lg:border-l lg:border-t-0">
          <HealthMonitor
            workflowId={selectedWorkflowId}
            snapshot={selectedSnapshot}
          />
          <div className="min-h-0 flex-1 overflow-hidden lg:min-h-[200px]">
            <AgentFeed items={feed} />
          </div>
        </aside>
      </div>
    </div>
  );
}
