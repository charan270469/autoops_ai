import { useEffect, useRef } from "react";
import { Radio } from "lucide-react";

/** @typedef {{ id: string, agent: string, message: string, ts: number, confidence?: number }} FeedItem */

const BADGE = {
  OrchestratorAgent:
    "border border-purple-500/40 bg-purple-500/15 text-purple-200",
  ITAgent: "border border-blue-500/40 bg-blue-500/15 text-blue-200",
  HRAgent: "border border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  FinanceAgent:
    "border border-amber-500/40 bg-amber-500/15 text-amber-100",
  DecisionAgent: "border border-red-500/40 bg-red-500/15 text-red-200",
  MonitorAgent: "border border-gray-500/40 bg-gray-500/15 text-gray-300",
};

function badgeClass(agent) {
  return BADGE[agent] ?? BADGE.MonitorAgent;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * @param {{ items: FeedItem[] }} props
 */
export function AgentFeed({ items }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [items]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-shell-border px-4 py-3">
        <Radio className="h-4 w-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">
          Live agent activity
        </span>
        <span className="ml-auto text-[10px] text-gray-600">
          Last {Math.min(20, items.length)}/20
        </span>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
      >
        {items.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-gray-600">
            Waiting for workflow events from the WebSocket…
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="agent-feed-enter rounded-lg border border-shell-border/80 bg-shell-card/60 px-2.5 py-2 shadow-sm"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass(item.agent)}`}
                  >
                    {item.agent}
                  </span>
                  <span className="font-mono text-[10px] text-gray-500">
                    {formatTime(item.ts)}
                  </span>
                  {typeof item.confidence === "number" && (
                    <span className="text-[10px] text-gray-500">
                      conf: {item.confidence.toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-snug text-gray-300">{item.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
