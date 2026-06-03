import { useEffect, useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
} from "lucide-react";
import { ENDPOINTS } from "../config/endpoints.js";

/**
 * @param {string | undefined} stepId
 */
function stepLabel(stepId) {
  if (!stepId) return "—";
  return stepId.replace(/_/g, " ");
}

/**
 * @param {object | null | undefined} snapshot
 * @param {object | null} health
 */
function predictedCompletion(snapshot, health) {
  if (!snapshot?.steps?.length) return null;
  const sla = health?.slaThresholdSecondsPerStep ?? 60;
  const steps = snapshot.steps;
  const done = steps.filter((s) =>
    ["success", "skipped", "failed"].includes(s.status)
  ).length;
  const remaining = Math.max(0, steps.length - done);
  const durations = steps
    .map((s) => (typeof s.duration === "number" ? s.duration : null))
    .filter((d) => d != null);
  const avg =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : sla * 0.5;
  const etaSec = remaining * avg;
  const d = new Date(Date.now() + etaSec * 1000);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * @param {object | null | undefined} snapshot
 * @param {string[]} breachedIds
 */
function bottleneckStep(snapshot, breachedIds) {
  if (!snapshot?.steps?.length) return null;
  const steps = snapshot.steps;
  let max = null;
  for (const s of steps) {
    if (typeof s.duration !== "number") continue;
    if (!max || s.duration > max.duration) max = s;
  }
  if (breachedIds?.length) {
    const b = steps.find((s) => breachedIds.includes(s.id));
    if (b) return b;
  }
  return max;
}

/**
 * @param {{ workflowId: string | null, snapshot: object | null | undefined }} props
 */
export function HealthMonitor({ workflowId, snapshot }) {
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!workflowId) {
      setHealth(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(ENDPOINTS.workflowHealth(workflowId));
        if (!res.ok) throw new Error("Health unavailable");
        const data = await res.json();
        if (!cancelled) {
          setHealth(data);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Error");
          setHealth(null);
        }
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [workflowId]);

  const overall = health?.overall ?? "";
  const sla = health?.slaThresholdSecondsPerStep ?? 60;

  const { tone, label, circleClass, pulse } = useMemo(() => {
    const o = String(overall).toLowerCase();
    if (o === "critical") {
      return {
        tone: "red",
        label: "RED",
        circleClass: "bg-red-500 shadow-[0_0_28px_rgba(239,68,68,0.55)]",
        pulse: true,
      };
    }
    if (o === "degraded") {
      return {
        tone: "yellow",
        label: "YELLOW",
        circleClass: "bg-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.45)]",
        pulse: false,
      };
    }
    return {
      tone: "green",
      label: "GREEN",
      circleClass: "bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.35)]",
      pulse: false,
    };
  }, [overall]);

  const currentStep = useMemo(() => {
    const steps = snapshot?.steps ?? [];
    const running = steps.find((s) => s.status === "running");
    if (running) return running;
    const pending = steps.find((s) => s.status === "pending");
    return pending ?? null;
  }, [snapshot]);

  const progressPct = useMemo(() => {
    const steps = snapshot?.steps ?? [];
    if (!steps.length) return 0;
    const done = steps.filter((s) => s.status === "success").length;
    return Math.round((done / steps.length) * 100);
  }, [snapshot]);

  const breachedIds = health?.breachedStepIds ?? [];
  const bottleneck = bottleneckStep(snapshot, breachedIds);

  const predicted = predictedCompletion(snapshot, health);

  const showWarn = tone === "yellow" || tone === "red";

  if (!workflowId) {
    return (
      <div className="border-t border-shell-border bg-[#12141c] p-4 text-sm text-gray-500">
        Select a workflow for health monitoring.
      </div>
    );
  }

  if (err) {
    return (
      <div className="border-t border-shell-border bg-[#12141c] p-4">
        <div className="flex items-center gap-2 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {err}
        </div>
      </div>
    );
  }

  if (!health?.found) {
    return (
      <div className="border-t border-shell-border bg-[#12141c] p-4 text-sm text-gray-500">
        Loading health…
      </div>
    );
  }

  return (
    <div className="border-t border-shell-border bg-[#12141c] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-200">
        <Activity className="h-4 w-4 text-cyan-400" />
        SLA & health
      </div>

      <div className="flex flex-col items-center gap-3 border-b border-shell-border/60 pb-4">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-black text-white ${circleClass} ${pulse ? "animate-pulse" : ""}`}
            title={`Overall: ${overall}`}
          >
            {label}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500">
              Overall health
            </p>
            <p className="text-sm font-medium capitalize text-gray-200">
              {overall.replace(/_/g, " ")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3 text-xs">
        <div>
          <p className="mb-1 text-[10px] uppercase text-gray-500">
            Current step
          </p>
          <p className="font-medium text-gray-200">
            {currentStep
              ? stepLabel(currentStep.id)
              : "—"}
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase text-gray-500">
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-emerald-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1 text-[10px] uppercase text-gray-500">
            <Gauge className="h-3 w-3" />
            SLA timeline (expected {sla}s / step)
          </p>
          <div className="space-y-2">
            {(snapshot?.steps ?? []).map((s) => {
              const dur =
                typeof s.duration === "number" ? s.duration : null;
              const durForBar = dur ?? 0;
              const isBn = bottleneck && s.id === bottleneck.id;
              const breached =
                breachedIds.includes(s.id) ||
                s.status === "failed" ||
                (typeof dur === "number" && dur > sla);
              let zone = "bg-emerald-500/80";
              if (breached) zone = "bg-red-500/80";
              else if (typeof dur === "number" && dur > sla * 0.75)
                zone = "bg-amber-400/90";

              const actualPct = Math.min(
                100,
                sla > 0 ? (durForBar / sla) * 100 : 0
              );

              return (
                <div
                  key={s.id}
                  className={`rounded-lg border px-2 py-1.5 ${
                    isBn
                      ? "border-orange-500/60 bg-orange-950/25 ring-1 ring-orange-500/30"
                      : "border-shell-border/60 bg-[#0f1117]/80"
                  }`}
                >
                  <div className="mb-1 flex justify-between gap-2 text-[10px] text-gray-400">
                    <span className="truncate font-mono">{s.id}</span>
                    <span>
                      {dur != null ? `${dur}s` : "—"} / {sla}s
                    </span>
                  </div>
                  <div className="relative h-2 overflow-hidden rounded bg-gray-800">
                    <div
                      className="absolute inset-y-0 left-0 w-1/3 bg-emerald-900/40"
                      title="Green zone"
                    />
                    <div
                      className="absolute inset-y-0 left-[33%] w-1/3 bg-amber-900/30"
                      title="Yellow zone"
                    />
                    <div
                      className="absolute inset-y-0 left-[66%] w-[34%] bg-red-900/30"
                      title="Red zone"
                    />
                    <div
                      className={`absolute inset-y-0 left-0 rounded ${zone}`}
                      style={{ width: `${Math.min(100, actualPct)}%` }}
                    />
                  </div>
                  {isBn && (
                    <p className="mt-1 text-[10px] text-orange-300/90">
                      Bottleneck candidate
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {predicted && (
          <div className="flex items-start gap-2 rounded-lg border border-shell-border/60 bg-[#0f1117]/60 px-2 py-2">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/80" />
            <div>
              <p className="text-[10px] uppercase text-gray-500">
                Predicted completion
              </p>
              <p className="text-sm text-gray-200">{predicted}</p>
            </div>
          </div>
        )}

        {showWarn && (
          <div
            className={`rounded-lg border px-3 py-2 ${
              tone === "red"
                ? "border-red-800/60 bg-red-950/30"
                : "border-amber-800/50 bg-amber-950/25"
            }`}
          >
            <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-gray-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Recommendation
            </p>
            <p className="text-[11px] leading-relaxed text-gray-400">
              {tone === "red"
                ? `Critical health: ${breachedIds.length ? `Review breached steps (${breachedIds.join(", ")}). ` : ""}Pause automated advances and assign human review before continuing.`
                : `Elevated risk: some steps are at SLA risk. Monitor running tasks and consider adding capacity or deferring non-critical steps.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
