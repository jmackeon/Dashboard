import {
  Chart as ChartJS,
  LineElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import { useActivity } from "../hooks/useActivity";
import type { WeeklySnapshot } from "../lib/reportStore";

ChartJS.register(LineElement, BarElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler);

// ─── Types ────────────────────────────────────────────────────────────────────

type WeekRow = {
  id: string;
  week_start: string;
  week_end: string;
  snapshot_json: WeeklySnapshot | null;
  created_at: string;
  // derived
  weekLabel: string;
  monthKey: string;        // "2026-01"
  monthLabel: string;      // "January 2026"
  overallPct: number;
  stableCount: number;
  totalSystems: number;
  status: "STABLE" | "ATTENTION" | "CRITICAL";
  systemPcts: Record<string, number>;
};

type MonthGroup = {
  monthKey: string;
  monthLabel: string;
  weeks: WeekRow[];
  // aggregated
  avgOverall: number;
  minOverall: number;
  maxOverall: number;
  status: "STABLE" | "ATTENTION" | "CRITICAL";
  isCurrentMonth: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CORE_SYSTEMS = ["MDM", "LACdrop", "Staff Biometric Attendance", "Toddle Parent"] as const;
const SYSTEM_COLORS: Record<string, string> = {
  MDM:                          "#F59E0B",
  LACdrop:                      "#2563EB",
  "Staff Biometric Attendance": "#0D9488",
  "Toddle Parent":              "#06B6D4",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: any): number {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}

function fmtWeekLabel(ws: string, we: string): string {
  const s = new Date(ws + "T12:00:00Z");
  const e = new Date(we + "T12:00:00Z");
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  const day = (d: Date) => String(d.getUTCDate()).padStart(2, "0");
  const mon = (d: Date) => d.toLocaleString("default", { month: "short" });
  if (sameMonth) return `${day(s)}–${day(e)} ${mon(e)} ${e.getUTCFullYear()}`;
  return `${day(s)} ${mon(s)}–${day(e)} ${mon(e)} ${e.getUTCFullYear()}`;
}

function monthKey(ws: string): string {
  return ws.slice(0, 7); // "2026-01"
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Same thresholds as ExecutiveDashboard pctStatus()
function pctStatus(p: number): "STABLE" | "ATTENTION" | "CRITICAL" {
  if (p >= 80) return "STABLE";
  if (p >= 70) return "ATTENTION";
  return "CRITICAL";
}

function deriveFromSnapshot(snap: WeeklySnapshot | null): {
  overallPct: number;
  stableCount: number;
  totalSystems: number;
  status: WeekRow["status"];
  systemPcts: Record<string, number>;
} {
  const cats = snap?.categories || [];

  // per-system pcts — check metrics block first, then focusPercent
  const systemPcts: Record<string, number> = {};
  for (const sys of CORE_SYSTEMS) {
    const cat = cats.find(c => c.name === sys);
    if (!cat) { systemPcts[sys] = 0; continue; }
    const m = cat.metrics || {};
    const v =
      typeof m.coverage_percent === "number" ? m.coverage_percent :
      typeof m.usage_percent    === "number" ? m.usage_percent    :
      typeof m.adoption_percent === "number" ? m.adoption_percent :
      cat.focusPercent;
    systemPcts[sys] = clamp(v);
  }

  // Option A: Digital Health = simple average of all systems
  const allPcts = Object.values(systemPcts);
  const overallPct = allPcts.length
    ? clamp(Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length))
    : 0;

  // Status auto-derived from pct thresholds (not stored status field)
  const statuses = Object.values(systemPcts).map(pctStatus);
  const hasCritical  = statuses.some(s => s === "CRITICAL");
  const hasAttention = statuses.some(s => s === "ATTENTION");
  const stableCount  = statuses.filter(s => s === "STABLE").length;

  return {
    overallPct,
    stableCount,
    totalSystems: CORE_SYSTEMS.length,
    status: hasCritical ? "CRITICAL" : hasAttention ? "ATTENTION" : "STABLE",
    systemPcts,
  };
}

function statusColor(s: WeekRow["status"]): string {
  if (s === "CRITICAL")  return "text-red-600";
  if (s === "ATTENTION") return "text-amber-500";
  return "text-emerald-500";
}

function statusBg(s: WeekRow["status"]): string {
  if (s === "CRITICAL")  return "border-red-200 bg-red-50";
  if (s === "ATTENTION") return "border-amber-200 bg-amber-50";
  return "border-emerald-200 bg-emerald-50";
}

function statusLabel(s: WeekRow["status"]): string {
  if (s === "CRITICAL")  return "Critical";
  if (s === "ATTENTION") return "Attention";
  return "Stable";
}

function deltaArrow(d: number) {
  if (d > 0) return { symbol: "▲", cls: "text-emerald-500" };
  if (d < 0) return { symbol: "▼", cls: "text-red-500" };
  return { symbol: "→", cls: "text-gray-400" };
}

// ─── Mini sparkline bar ────────────────────────────────────────────────────────

function Sparkbar({ values, color }: { values: number[]; color: string }) {
  if (!values.length) return <span className="text-xs text-gray-300">—</span>;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5 h-6">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm transition-all"
          style={{
            height: `${Math.max(4, (v / max) * 24)}px`,
            backgroundColor: color,
            opacity: i === values.length - 1 ? 1 : 0.45 + (i / values.length) * 0.55,
          }}
        />
      ))}
    </div>
  );
}

// ─── Week Card ────────────────────────────────────────────────────────────────

function WeekCard({ row, delta }: { row: WeekRow; delta: number }) {
  const arr = deltaArrow(delta);
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-500">{row.weekLabel}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-2xl font-black ${statusColor(row.status)}`}>
              {row.overallPct}%
            </span>
            {delta !== 0 && (
              <span className={`text-xs font-bold ${arr.cls}`}>
                {arr.symbol} {Math.abs(delta)}%
              </span>
            )}
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBg(row.status)} ${statusColor(row.status)}`}>
          {statusLabel(row.status)}
        </span>
      </div>

      {/* System pct bars */}
      <div className="mt-3 space-y-1.5">
        {CORE_SYSTEMS.map(sys => {
          const pct = row.systemPcts[sys] ?? 0;
          const color = SYSTEM_COLORS[sys];
          return (
            <div key={sys} className="flex items-center gap-2">
              <span className="w-28 flex-shrink-0 truncate text-[10px] text-gray-400">{sys}</span>
              <div className="relative flex-1 h-1.5 rounded-full bg-gray-100">
                <div
                  className="absolute left-0 top-0 h-1.5 rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <span className="w-7 text-right text-[10px] font-semibold text-gray-600">{pct}%</span>
            </div>
          );
        })}
      </div>

      {/* Stable count */}
      <p className="mt-2.5 text-[10px] text-gray-400">
        {row.stableCount}/{row.totalSystems} systems stable
      </p>
    </div>
  );
}

// ─── Month Group Card ─────────────────────────────────────────────────────────

function MonthCard({
  group,
  deltaFromPrev,
  allWeeksForSparklines,
}: {
  group: MonthGroup;
  deltaFromPrev: number;
  allWeeksForSparklines: WeekRow[];
}) {
  const [expanded, setExpanded] = useState(group.isCurrentMonth);
  const arr = deltaArrow(deltaFromPrev);

  // Build delta map within this group's weeks
  const weeksChronological = [...group.weeks].sort(
    (a, b) => new Date(a.week_start).getTime() - new Date(b.week_start).getTime()
  );

  const weekDeltaMap = new Map<string, number>();
  for (let i = 0; i < weeksChronological.length; i++) {
    const prev = allWeeksForSparklines.find(
      w => new Date(w.week_start).getTime() < new Date(weeksChronological[i].week_start).getTime()
    );
    weekDeltaMap.set(
      weeksChronological[i].id,
      prev ? weeksChronological[i].overallPct - prev.overallPct : 0
    );
  }

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden ${group.isCurrentMonth ? "border-blue-100" : "border-gray-100"}`}>
      {/* Month header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full bg-white px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Month label + current badge */}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-gray-900">{group.monthLabel}</h3>
                {group.isCurrentMonth && (
                  <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                    Current
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-gray-400">
                {group.weeks.length} week{group.weeks.length !== 1 ? "s" : ""}
                {!group.isCurrentMonth && ` · Avg ${group.avgOverall}% · Range ${group.minOverall}–${group.maxOverall}%`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Sparkline for the month */}
            <div className="hidden sm:block">
              <Sparkbar
                values={weeksChronological.map(w => w.overallPct)}
                color="#2563EB"
              />
            </div>

            {/* Avg % + delta */}
            <div className="text-right">
              <div className={`text-xl font-black ${statusColor(group.status)}`}>
                {group.isCurrentMonth ? group.weeks[0]?.overallPct ?? "—" : group.avgOverall}%
              </div>
              {deltaFromPrev !== 0 && (
                <div className={`text-xs font-bold ${arr.cls}`}>
                  {arr.symbol} {Math.abs(deltaFromPrev)}%
                </div>
              )}
            </div>

            {/* Status badge */}
            <span className={`hidden md:inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusBg(group.status)} ${statusColor(group.status)}`}>
              {statusLabel(group.status)}
            </span>

            {/* Chevron */}
            <svg
              className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </div>
      </button>

      {/* Expanded weeks */}
      {expanded && (
        <div className="border-t border-gray-100 bg-[#F7F8FA] px-4 py-4">
          {/* System sparklines across the month */}
          {!group.isCurrentMonth && weeksChronological.length > 1 && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {CORE_SYSTEMS.map(sys => (
                <div key={sys} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-gray-400 truncate">{sys}</p>
                  <div className="mt-1.5">
                    <Sparkbar
                      values={weeksChronological.map(w => w.systemPcts[sys] ?? 0)}
                      color={SYSTEM_COLORS[sys]}
                    />
                  </div>
                  <p className="mt-1 text-xs font-bold text-gray-700">
                    {weeksChronological[weeksChronological.length - 1]?.systemPcts[sys] ?? 0}%
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Individual week cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {weeksChronological.map(w => (
              <WeekCard
                key={w.id}
                row={w}
                delta={weekDeltaMap.get(w.id) ?? 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function History() {
  const { log } = useActivity();

  // Log page view once on mount
  useEffect(() => { log("PAGE_VIEW", "History"); }, []);
  const [rows,    setRows]    = useState<WeekRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await apiFetch<{ items: any[] }>("/api/history?limit=52");
        if (!alive) return;

        const mapped: WeekRow[] = (res.items || [])
          .filter(r => r.week_start && r.week_end)
          .map(r => {
            const snap = r.snapshot_json as WeeklySnapshot | null;
            const derived = deriveFromSnapshot(snap);
            const ws = String(r.week_start);
            const we = String(r.week_end);
            const mk = monthKey(ws);
            return {
              id: String(r.id),
              week_start: ws,
              week_end:   we,
              snapshot_json: snap,
              created_at: String(r.created_at || ""),
              weekLabel:   fmtWeekLabel(ws, we),
              monthKey:    mk,
              monthLabel:  monthLabel(mk),
              ...derived,
            };
          })
          // Newest first
          .sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime());

        setRows(mapped);
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load history");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ─── Month grouping logic ──────────────────────────────────────────────────
  // Rule: a month group is shown as a monthly card ONLY when it is a
  // *completed* month (i.e. monthKey < currentMonthKey).
  // The current month always shows as individual weeks.

  const curMonthKey = currentMonthKey();

  const monthGroups = useMemo<MonthGroup[]>(() => {
    const groupMap = new Map<string, WeekRow[]>();
    for (const row of rows) {
      if (!groupMap.has(row.monthKey)) groupMap.set(row.monthKey, []);
      groupMap.get(row.monthKey)!.push(row);
    }

    return Array.from(groupMap.entries())
      .map(([mk, weeks]) => {
        const overalls = weeks.map(w => w.overallPct);
        const avgOverall = Math.round(overalls.reduce((s, v) => s + v, 0) / (overalls.length || 1));
        const hasCritical  = weeks.some(w => w.status === "CRITICAL");
        const hasAttention = weeks.some(w => w.status === "ATTENTION");
        return {
          monthKey: mk,
          monthLabel: monthLabel(mk),
          weeks,
          avgOverall,
          minOverall: Math.min(...overalls),
          maxOverall: Math.max(...overalls),
          status: (hasCritical ? "CRITICAL" : hasAttention ? "ATTENTION" : "STABLE") as MonthGroup["status"],
          isCurrentMonth: mk === curMonthKey,
        };
      })
      // Newest month first
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [rows, curMonthKey]);

  // ─── KPI stats ────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const total     = rows.length;
    const avgAll    = Math.round(rows.reduce((s, r) => s + r.overallPct, 0) / total);
    const bestWeek  = [...rows].sort((a, b) => b.overallPct - a.overallPct)[0];
    const worstWeek = [...rows].sort((a, b) => a.overallPct - b.overallPct)[0];

    // Biggest single-week improvement
    const sorted = [...rows].sort((a, b) => new Date(a.week_start).getTime() - new Date(b.week_start).getTime());
    let bestImprovement: { delta: number; week: WeekRow } | null = null;
    for (let i = 1; i < sorted.length; i++) {
      const d = sorted[i].overallPct - sorted[i - 1].overallPct;
      if (!bestImprovement || d > bestImprovement.delta) {
        bestImprovement = { delta: d, week: sorted[i] };
      }
    }

    // Current streak
    let streak = 0;
    let streakStatus: "stable" | "attention" = "stable";
    for (const r of rows) { // rows are newest-first
      if (r.status === "STABLE") {
        if (streakStatus === "stable" || streak === 0) { streak++; streakStatus = "stable"; }
        else break;
      } else {
        if (streakStatus === "attention" || streak === 0) { streak++; streakStatus = "attention"; }
        else break;
      }
    }

    return { total, avgAll, bestWeek, worstWeek, bestImprovement, streak, streakStatus };
  }, [rows]);

  // ─── Overall trend chart (chronological) ──────────────────────────────────

  const trendData = useMemo(() => {
    const sorted = [...rows].sort((a, b) => new Date(a.week_start).getTime() - new Date(b.week_start).getTime());
    return {
      labels: sorted.map(r => r.weekLabel),
      datasets: [{
        label: "Overall Digital Health",
        data: sorted.map(r => r.overallPct),
        borderColor: "#2563EB",
        backgroundColor: "rgba(37,99,235,0.07)",
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
      }],
    };
  }, [rows]);

  // Per-system trend
  const systemTrendData = useMemo(() => {
    const sorted = [...rows].sort((a, b) => new Date(a.week_start).getTime() - new Date(b.week_start).getTime());
    const labels = sorted.map(r => r.weekLabel);
    return {
      labels,
      datasets: CORE_SYSTEMS.map(sys => ({
        label: sys,
        data: sorted.map(r => r.systemPcts[sys] ?? 0),
        borderColor: SYSTEM_COLORS[sys],
        backgroundColor: "transparent",
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
      })),
    };
  }, [rows]);

  const lineOptions: ChartOptions<"line"> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } },
    },
    scales: {
      y: { beginAtZero: true, max: 100, ticks: { callback: v => `${v}%` }, grid: { color: "rgba(0,0,0,0.05)" } },
      x: { grid: { display: false }, ticks: { maxRotation: 30, autoSkip: true, font: { size: 10 } } },
    },
  }), []);

  // ─── Delta between month groups ───────────────────────────────────────────
  const monthDeltaMap = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < monthGroups.length; i++) {
      const prev = monthGroups[i + 1];
      m.set(monthGroups[i].monthKey, prev ? monthGroups[i].avgOverall - prev.avgOverall : 0);
    }
    return m;
  }, [monthGroups]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center gap-2 py-16 text-sm text-gray-400">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          Loading history…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">History</h1>
          <p className="mt-1 text-sm text-gray-500">
            Weekly and monthly performance across all IT systems.
          </p>
          {error && (
            <p className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              ⚠ {error}
            </p>
          )}
        </div>

        {/* ── KPI callout strip ─────────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

            {/* Avg overall */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Overall Average</p>
              <p className="mt-1.5 text-3xl font-black text-gray-900">{stats.avgAll}%</p>
              <p className="mt-1 text-[10px] text-gray-400">across {stats.total} weeks</p>
            </div>

            {/* Best week */}
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Best Week</p>
              <p className="mt-1.5 text-3xl font-black text-emerald-600">{stats.bestWeek.overallPct}%</p>
              <p className="mt-1 text-[10px] text-emerald-600/70">{stats.bestWeek.weekLabel}</p>
            </div>

            {/* Biggest jump */}
            {stats.bestImprovement && stats.bestImprovement.delta > 0 && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Biggest Jump</p>
                <p className="mt-1.5 text-3xl font-black text-blue-600">+{stats.bestImprovement.delta}%</p>
                <p className="mt-1 text-[10px] text-blue-600/70">{stats.bestImprovement.week.weekLabel}</p>
              </div>
            )}

            {/* Streak */}
            <div className={`rounded-2xl border p-4 shadow-sm ${
              stats.streakStatus === "stable"
                ? "border-emerald-100 bg-emerald-50"
                : "border-amber-100 bg-amber-50"
            }`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${
                stats.streakStatus === "stable" ? "text-emerald-600" : "text-amber-600"
              }`}>
                {stats.streakStatus === "stable" ? "Stable Streak" : "Attention Streak"}
              </p>
              <p className={`mt-1.5 text-3xl font-black ${
                stats.streakStatus === "stable" ? "text-emerald-600" : "text-amber-600"
              }`}>
                {stats.streak}w
              </p>
              <p className={`mt-1 text-[10px] ${
                stats.streakStatus === "stable" ? "text-emerald-600/70" : "text-amber-600/70"
              }`}>
                consecutive weeks
              </p>
            </div>
          </div>
        )}

        {/* ── Trend charts ─────────────────────────────────────────────── */}
        {rows.length > 1 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* Overall trend */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">Overall Digital Health</h2>
              <p className="mt-0.5 text-xs text-gray-400">Weekly trend</p>
              <div className="mt-4 h-[180px]">
                <Line data={trendData} options={lineOptions} />
              </div>
            </div>

            {/* Per-system trend */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">System Trends</h2>
              <div className="mt-1 flex flex-wrap gap-2">
                {CORE_SYSTEMS.map(sys => (
                  <span key={sys} className="flex items-center gap-1 text-[10px] text-gray-500">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: SYSTEM_COLORS[sys] }} />
                    {sys}
                  </span>
                ))}
              </div>
              <div className="mt-3 h-[180px]">
                <Line data={systemTrendData} options={lineOptions} />
              </div>
            </div>
          </div>
        )}

        {/* ── Month / week groups ───────────────────────────────────────── */}
        {monthGroups.length === 0 && !loading && (
          <div className="rounded-2xl border border-gray-100 bg-white px-6 py-10 text-center">
            <p className="text-sm font-semibold text-gray-500">No history yet</p>
            <p className="mt-1 text-xs text-gray-400">
              Run a weekly rollup from Updates to start building history.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {monthGroups.map(group => (
            <MonthCard
              key={group.monthKey}
              group={group}
              deltaFromPrev={monthDeltaMap.get(group.monthKey) ?? 0}
              allWeeksForSparklines={rows}
            />
          ))}
        </div>

        <p className="pb-2 text-center text-xs text-gray-300">
          IT &amp; Digital Systems — London Academy Casablanca
        </p>
      </div>
    </AppShell>
  );
}