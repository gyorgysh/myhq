import { useEffect, useState } from "react";
import {
  api,
  type PlanView,
  type ClaudeUsageSnapshot,
  type ProbeResult,
  type UsageLimitWindow,
} from "../api.ts";
import { usePoll } from "../lib/usePoll.ts";
import { Card, Button, Empty, Metric } from "./ui.tsx";
import { ms, usd, relTime } from "../lib/format.ts";

// ---------------------------------------------------------------------------
// Root view
// ---------------------------------------------------------------------------

export function UsageView({ onAuthError }: { onAuthError: () => void }) {
  const { data: myhq, error } = usePoll(api.usage, 15000, onAuthError);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [claude, setClaude] = useState<ClaudeUsageSnapshot | null>(null);
  const [probeRunning, setProbeRunning] = useState(false);

  useEffect(() => {
    api.plan().then(setPlan).catch(() => {});
    api.usageProbe().then(setProbe).catch(() => {});
    api.claudeUsage().then(setClaude).catch(() => {});
  }, []);

  if (error) return <Empty>Failed to load: {error}</Empty>;

  const refreshProbe = async () => {
    setProbeRunning(true);
    await api.runProbe().catch(() => {});
    // Poll until fresh result arrives.
    let attempts = 0;
    const poll = setInterval(async () => {
      const p = await api.usageProbe().catch(() => null);
      if (p) setProbe(p);
      if (++attempts >= 15) clearInterval(poll);
    }, 2000);
    setTimeout(() => { clearInterval(poll); setProbeRunning(false); }, 30_000);
  };

  // Derive plan from probe auto-detection when available.
  const detectedPlan =
    probe?.account?.hasMax ? "Claude Max" :
    probe?.account?.hasPro ? "Claude Pro" :
    probe?.account?.subscriptionType ? capFirst(probe.account.subscriptionType) :
    null;

  const isSubscription = Boolean(probe?.account?.hasPro || probe?.account?.hasMax);
  const hasApiCap = !isSubscription && plan && plan.monthlyCap > 0;

  return (
    <div className="space-y-4">
      {/* Live limits — real OAuth data */}
      <LiveLimitsCard
        probe={probe}
        detectedPlan={detectedPlan}
        probeRunning={probeRunning}
        onRefresh={refreshProbe}
      />

      {/* Historical activity from stats-cache */}
      {claude && <ActivityCard claude={claude} />}

      {/* Budget tracker — only for API plan with a cap set */}
      {hasApiCap && plan && (
        <Card title="API budget this period">
          <BudgetBar plan={plan} />
        </Card>
      )}

      {/* MyHQ session metrics */}
      {myhq && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <Metric
                label={isSubscription ? "API cost today" : "Cost today"}
                value={usd(myhq.today.costUsd)}
                sub={`${myhq.today.turns} turn${myhq.today.turns === 1 ? "" : "s"}`}
              />
            </Card>
            <Card>
              <Metric
                label={isSubscription ? "API cost lifetime" : "Cost lifetime"}
                value={usd(myhq.total.costUsd)}
                sub={`${myhq.total.turns} turns total`}
              />
            </Card>
            <Card>
              <Metric label="Time today" value={ms(myhq.today.durationMs)} />
            </Card>
            <Card>
              <Metric label="Time lifetime" value={ms(myhq.total.durationMs)} />
            </Card>
          </div>

          <Card title={isSubscription ? "MyHQ agent cost per day (last 30 days)" : "Daily cost (last 30 days)"}>
            <CostChart myhq={myhq} plan={plan} isSubscription={isSubscription} />
            {isSubscription && (
              <p className="mt-2 text-xs text-fg-faint">
                Reflects API token charges routed through MyHQ agents. Your {detectedPlan ?? "subscription"} is billed separately at a flat monthly rate.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live limits card
// ---------------------------------------------------------------------------

function barColor(s: UsageLimitWindow["severity"]): string {
  return s === "critical" ? "bg-red-500" : s === "warning" ? "bg-amber-400" : "bg-accent";
}
function textColor(s: UsageLimitWindow["severity"]): string {
  return s === "critical" ? "text-red-400" : s === "warning" ? "text-amber-400" : "text-emerald-400";
}

function formatMs(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function LimitBar({ lim }: { lim: UsageLimitWindow }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const resetsInMs = Math.max(0, new Date(lim.resetsAt).getTime() - Date.now());
  const pct = Math.min(100, lim.percent);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-dim">{lim.label}</span>
        <span className={`text-2xl font-bold tabular ${textColor(lim.severity)}`}>{lim.percent}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor(lim.severity)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-faint">{lim.severity === "normal" ? "within limits" : lim.severity}</span>
        <span className={`font-medium ${resetsInMs < 600_000 ? "text-amber-400" : "text-fg-dim"}`}>
          resets in {formatMs(resetsInMs)}
        </span>
      </div>
    </div>
  );
}

function LiveLimitsCard({
  probe,
  detectedPlan,
  probeRunning,
  onRefresh,
}: {
  probe: ProbeResult | null;
  detectedPlan: string | null;
  probeRunning: boolean;
  onRefresh: () => void;
}) {
  const probedAgo = probe?.probedAt
    ? Date.now() - new Date(probe.probedAt).getTime()
    : null;

  return (
    <Card
      title="Claude usage limits"
      right={
        <div className="flex items-center gap-2">
          {detectedPlan && (
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
              {detectedPlan}
            </span>
          )}
          <Button onClick={onRefresh} disabled={probeRunning}>
            {probeRunning ? "Checking…" : "Refresh"}
          </Button>
        </div>
      }
    >
      {!probe || probe.source === "none" ? (
        <p className="text-sm text-fg-faint">No data yet. Click Refresh.</p>
      ) : probe.source === "fallback" ? (
        <p className="text-sm text-amber-400">
          {probe.error ?? "OAuth unavailable. Install Claude Code and run claude auth login."}
        </p>
      ) : probe.limits.length === 0 ? (
        <p className="text-sm text-fg-faint">No active limits returned. You may be within all thresholds.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-6 sm:grid-cols-2">
            {probe.limits.slice(0, 2).map((lim) => (
              <LimitBar key={lim.label} lim={lim} />
            ))}
          </div>
          {probedAgo !== null && (
            <p className="text-xs text-fg-faint">
              Updated {probedAgo < 5000 ? "just now" : relTime(new Date(probe.probedAt!).getTime())}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Historical activity (stats-cache)
// ---------------------------------------------------------------------------

function ActivityCard({ claude }: { claude: ClaudeUsageSnapshot }) {
  const days = [...claude.recentDays].reverse();
  const maxMsg = Math.max(1, ...days.map((d) => d.messageCount));

  return (
    <Card title="Activity history">
      <div className="space-y-4">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={claude.hasTodayData ? "Messages today" : `Messages (${claude.lastRecordedDay?.date ?? "last"})`}
            value={(claude.lastRecordedDay?.messageCount ?? 0).toLocaleString()}
          />
          <Tile
            label="Messages this week"
            value={claude.weekly.count.toLocaleString()}
          />
          <Tile
            label="Sessions (last day)"
            value={(claude.lastRecordedDay?.sessionCount ?? 0).toLocaleString()}
          />
          <Tile
            label="Tool calls (last day)"
            value={(claude.lastRecordedDay?.toolCallCount ?? 0).toLocaleString()}
          />
        </div>

        {/* Message sparkline */}
        {days.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-dim">
              Messages per day (last {days.length} days)
            </p>
            <div className="flex h-20 items-end gap-0.5">
              {days.map((d) => {
                const isLatest = d.date === claude.lastRecordedDay?.date;
                return (
                  <div
                    key={d.date}
                    className="group flex flex-1 flex-col items-center justify-end"
                    title={`${d.date}: ${d.messageCount.toLocaleString()} messages`}
                  >
                    <div
                      className={`w-full min-h-[2px] rounded-t transition-all ${
                        isLatest ? "bg-accent" : "bg-accent/30 group-hover:bg-accent/60"
                      }`}
                      style={{ height: `${(d.messageCount / maxMsg) * 100}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Token breakdown */}
        {Object.keys(claude.lastDayTokens).length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-dim">
              Tokens by model — {claude.lastRecordedDay?.date ?? "last recorded day"}
            </p>
            <div className="space-y-1.5">
              {Object.entries(claude.lastDayTokens).map(([model, t]) => {
                const total = t.inputTokens + t.outputTokens;
                const short = model.replace(/^(claude-|anthropic\/|qwen\/)/i, "").slice(0, 42);
                return (
                  <div key={model} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 truncate font-mono text-fg-dim" title={model}>{short}</span>
                    <span className="tabular text-fg">{(total / 1_000_000).toFixed(2)}M</span>
                    <span className="hidden sm:inline text-fg-faint">
                      in {(t.inputTokens / 1_000_000).toFixed(2)}M · out {(t.outputTokens / 1_000_000).toFixed(2)}M
                      {t.cacheReadInputTokens > 0 && ` · cache ${(t.cacheReadInputTokens / 1_000_000).toFixed(2)}M`}
                    </span>
                    {t.costUSD > 0 && <span className="ml-auto tabular text-fg-faint">${t.costUSD.toFixed(4)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Lifetime footer */}
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 border-t border-line pt-2 text-xs text-fg-faint">
          <span><span className="text-fg-dim font-medium">{claude.totalMessages.toLocaleString()}</span> total messages</span>
          <span><span className="text-fg-dim font-medium">{claude.totalSessions.toLocaleString()}</span> sessions</span>
          {claude.firstSessionDate && (
            <span>since {new Date(claude.firstSessionDate).toLocaleDateString()}</span>
          )}
          {!claude.hasTodayData && (
            <span className="ml-auto italic">Stats update when sessions close</span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Budget bar (API plan only)
// ---------------------------------------------------------------------------

function BudgetBar({ plan }: { plan: PlanView }) {
  const pct = Math.min(100, plan.pctUsed);
  const color = plan.pctUsed >= 90 ? "bg-red-500" : plan.pctUsed >= 70 ? "bg-amber-400" : "bg-emerald-400";
  const tcolor = plan.pctUsed >= 90 ? "text-red-400" : plan.pctUsed >= 70 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular ${tcolor}`}>${plan.periodCostUsd.toFixed(2)}</span>
        <span className="text-xs text-fg-faint">of ${plan.monthlyCap} cap ({plan.pctUsed.toFixed(0)}%)</span>
        <span className="ml-auto text-xs text-fg-faint">{plan.daysUntilReset}d until reset</span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-fg-faint">
        <span>Avg/day: ${plan.dailyAvgUsd.toFixed(4)}</span>
        <span>Est. month: ${plan.estimatedMonthlyUsd.toFixed(2)}</span>
        {plan.periodStart && <span>Since: {plan.periodStart}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily cost chart
// ---------------------------------------------------------------------------

function CostChart({
  myhq,
  plan,
  isSubscription,
}: {
  myhq: { daily: Array<{ day: string; costUsd: number; turns: number }> };
  plan: PlanView | null;
  isSubscription: boolean;
}) {
  const recent = myhq.daily.slice(-30);
  const maxCost = Math.max(0.0001, ...recent.map((d) => d.costUsd));
  const periodStart = plan?.periodStart;

  if (recent.length === 0) return <Empty>No activity recorded yet.</Empty>;

  return (
    <div className="relative flex h-40 items-end gap-1">
      {!isSubscription && plan && plan.monthlyCap > 0 && (() => {
        const dailyCap = plan.monthlyCap / 30;
        const capPct = (dailyCap / maxCost) * 100;
        if (capPct > 100) return null;
        return (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-red-400/40"
            style={{ bottom: `${capPct}%` }}
            title={`Daily cap ceiling: $${dailyCap.toFixed(4)}`}
          />
        );
      })()}
      {recent.map((d) => {
        const inPeriod = periodStart ? d.day >= periodStart : true;
        return (
          <div key={d.day} className="group flex flex-1 flex-col items-center justify-end">
            <div
              className={`w-full rounded-t transition-all ${
                inPeriod ? "bg-accent/70 group-hover:bg-accent" : "bg-fg-faint/20 group-hover:bg-fg-faint/40"
              }`}
              style={{ height: `${(d.costUsd / maxCost) * 100}%` }}
              title={`${d.day}: ${usd(d.costUsd)} · ${d.turns} turns`}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-input p-3">
      <p className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</p>
      <p className="mt-1 text-xl font-bold tabular text-fg">{value}</p>
    </div>
  );
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
