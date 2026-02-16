// src/pages/ExecutiveDashboard.tsx

import {
  Chart as ChartJS,
  LineElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import { getDefaultSnapshot, type WeeklySnapshot } from "../lib/reportStore";

ChartJS.register(
  LineElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
);

/* ----------------------------------------
   Types
---------------------------------------- */
type LatestMetricRow = {
  system_key: string;
  metric_key: string;
  metric_value: number;
  source: string;
  meta: any;
  date: string;
  updated_at: string;
};

type SystemLastUpdated = {
  system_key: string;
  last_updated: string;
};

type HistoryApiRow = {
  id: string;
  week_start?: string;
  week_end?: string;
  created_at?: string;
  snapshot_json?: WeeklySnapshot;
};

type FocusRow = {
  id: string;
  date: string;
  system_key: string;
  title: string;
  details: string;
  kind?: "FOCUS";
  created_at: string;
};

type FocusWeekResponse = {
  week_start: string;
  week_end: string;
  weekLabel: string;
  items: FocusRow[];
};

/* ----------------------------------------
   Helpers
---------------------------------------- */
function clampPercent(v: any) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}

function niceTimeAgo(iso?: string | null) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";

  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function buildLiveMap(rows: LatestMetricRow[]) {
  const m = new Map<string, Record<string, LatestMetricRow>>();
  for (const r of rows || []) {
    const sys = r.system_key || "General";
    if (!m.has(sys)) m.set(sys, {});
    m.get(sys)![r.metric_key] = r;
  }
  return m;
}

/**
 * Week label format:
 * "20–26 Jan 2026"
 */
function formatWeekLabel(week_start?: string, week_end?: string) {
  if (!week_start || !week_end) return "—";

  if (week_start === week_end) {
    return new Date(week_start).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const s = new Date(week_start);
  const e = new Date(week_end);

  const sameMonth =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();

  if (sameMonth) {
    const startDay = s.toLocaleDateString(undefined, { day: "2-digit" });
    const endFull = e.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return `${startDay}–${endFull}`;
  }

  const startFull = s.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
  const endFull = e.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `${startFull}–${endFull}`;
}

/**
 * Resolve the “headline percent” per system from live metrics.
 */
function resolveLivePercent(
  systemName: string,
  liveMap: Map<string, Record<string, LatestMetricRow>>,
  fallback?: number
) {
  const sys = liveMap.get(systemName) || {};
  const key =
    systemName === "MDM"
      ? "coverage_percent"
      : systemName === "Staff Attendance"
        ? "usage_percent"
        : systemName === "Online Test"
          ? "progress_percent"
          : "adoption_percent";

  const live = sys[key]?.metric_value;
  if (typeof live === "number") return clampPercent(live);
  return clampPercent(fallback ?? 0);
}

function deriveOverallFromSnapshot(snapshot?: WeeklySnapshot) {
  const cats = snapshot?.categories || [];
  const total = cats.length || 1;
  const stable = cats.filter((c) => c.status === "STABLE").length;
  const stabilityPct = Math.round((stable / total) * 100);

  const userCats = cats.filter((c) => c.name !== "MDM");
  const adoptionAvg = Math.round(
    userCats.reduce((sum, c) => sum + clampPercent(c.focusPercent), 0) /
      (userCats.length || 1)
  );

  const overall = Math.round(stabilityPct * 0.6 + adoptionAvg * 0.4);
  return clampPercent(overall);
}

function deltaText(delta: number) {
  if (delta > 0) return `+${delta}%`;
  if (delta < 0) return `${delta}%`;
  return "0%";
}

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull "534/603" style pair from:
 * 1) meta on main percent metric (preferred)
 * 2) fallback metric keys
 */
function getRawPairForSystem(
  systemName: string,
  sys: Record<string, LatestMetricRow>
): { a: number | null; b: number | null; labelA: string; labelB: string } {
  const mainKey =
    systemName === "MDM"
      ? "coverage_percent"
      : systemName === "Staff Attendance"
        ? "usage_percent"
        : systemName === "Online Test"
          ? "progress_percent"
          : "adoption_percent";

  const meta = sys?.[mainKey]?.meta;

  if (meta && typeof meta === "object") {
    const active = safeNum(
      (meta as any).active ?? (meta as any).enrolled ?? (meta as any).present
    );
    const total = safeNum((meta as any).total);
    if (active !== null && total !== null) {
      const labelA =
        (meta as any).active != null
          ? "Active"
          : (meta as any).enrolled != null
            ? "Enrolled"
            : (meta as any).present != null
              ? "Present"
              : "Count";
      return { a: active, b: total, labelA, labelB: "Total" };
    }
  }

  if (systemName === "LACdrop") {
    return {
      a: safeNum(sys["parents_active"]?.metric_value),
      b: safeNum(sys["total_parents"]?.metric_value),
      labelA: "Active",
      labelB: "Total",
    };
  }

  if (systemName === "Toddle Parent") {
    return {
      a: safeNum(sys["parents_logged_in"]?.metric_value),
      b: safeNum(sys["total_parents"]?.metric_value),
      labelA: "Logged in",
      labelB: "Total",
    };
  }

  if (systemName === "Staff Attendance") {
    return {
      a: safeNum(sys["staff_captured"]?.metric_value),
      b: safeNum(sys["total_staff"]?.metric_value),
      labelA: "Captured",
      labelB: "Total",
    };
  }

  if (systemName === "MDM") {
    return {
      a: safeNum(sys["devices_enrolled"]?.metric_value),
      b: safeNum(sys["total_devices"]?.metric_value),
      labelA: "Enrolled",
      labelB: "Total",
    };
  }

  return { a: null, b: null, labelA: "Count", labelB: "Total" };
}

/**
 * % ring (no libs)
 */
function PercentRing({ value, colorClass }: { value: number; colorClass: string }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;

  return (
    <div className="relative h-20 w-20">
      <svg viewBox="0 0 80 80" className="h-20 w-20">
        <circle cx="40" cy="40" r={r} stroke="rgba(0,0,0,0.10)" strokeWidth="10" fill="none" />
        <circle
          cx="40"
          cy="40"
          r={r}
          stroke="currentColor"
          className={colorClass}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 40 40)"
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        <div className="text-xl font-bold text-gray-900">{value}%</div>
        <div className="text-xs text-gray-500">Complete</div>
      </div>
    </div>
  );
}

function statusPillFromSnapshot(status?: string) {
  if (status === "CRITICAL")
    return { label: "CRITICAL", cls: "bg-red-50 text-red-700 border-red-200" };
  if (status === "ATTENTION")
    return { label: "ATTENTION", cls: "bg-amber-50 text-amber-800 border-amber-200" };
  return { label: "STABLE", cls: "bg-green-50 text-green-800 border-green-200" };
}

function ringColorForSystem(systemName: string) {
  if (systemName === "LACdrop") return "text-blue-600";
  if (systemName === "Toddle Parent") return "text-cyan-500";
  if (systemName === "Staff Attendance") return "text-teal-600";
  if (systemName === "MDM") return "text-amber-500";
  return "text-gray-600";
}

/* ----------------------------------------
   Component
---------------------------------------- */
export default function ExecutiveDashboard() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [weekEnd, setWeekEnd] = useState<string | null>(null);

  const [latestMetrics, setLatestMetrics] = useState<LatestMetricRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<SystemLastUpdated[]>([]);
  const [history3, setHistory3] = useState<HistoryApiRow[]>([]);

  // Focus items from backend
  const [focusWeek, setFocusWeek] = useState<FocusWeekResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const liveMap = useMemo(() => buildLiveMap(latestMetrics), [latestMetrics]);

  const lastUpdatedMap = useMemo(() => {
    const m = new Map<string, string>();
    (lastUpdated || []).forEach((r) => m.set(r.system_key, r.last_updated));
    return m;
  }, [lastUpdated]);

  const CORE_APPS = ["MDM", "LACdrop", "Toddle Parent", "Staff Attendance", "Online Test"] as const;
  type CoreApp = (typeof CORE_APPS)[number];

  const [activeAppTab, setActiveAppTab] = useState<CoreApp>("MDM");

  const activeTabSnapshot = useMemo(() => {
    return snapshot.categories.find((c) => c.name === activeAppTab);
  }, [snapshot.categories, activeAppTab]);

  const activeTabStatus = useMemo(() => {
    return statusPillFromSnapshot(activeTabSnapshot?.status);
  }, [activeTabSnapshot?.status]);

  const activeTabSys = useMemo(() => {
    return liveMap.get(activeAppTab) || {};
  }, [liveMap, activeAppTab]);

  const activeTabPercent = useMemo(() => {
    const snap = snapshot.categories.find((c) => c.name === activeAppTab);
    return resolveLivePercent(activeAppTab, liveMap, snap?.focusPercent);
  }, [activeAppTab, snapshot.categories, liveMap]);

  const activeTabPair = useMemo(() => {
    return getRawPairForSystem(activeAppTab, activeTabSys);
  }, [activeAppTab, activeTabSys]);

  const activeTabNote = useMemo(() => {
    const mainKey =
      activeAppTab === "MDM"
        ? "coverage_percent"
        : activeAppTab === "Staff Attendance"
          ? "usage_percent"
          : activeAppTab === "Online Test"
            ? "progress_percent"
            : "adoption_percent";

    const meta = activeTabSys?.[mainKey]?.meta;
    const metaNote = meta && typeof meta === "object" ? (meta as any).note : null;
    return (metaNote || activeTabSnapshot?.notes || "").toString();
  }, [activeAppTab, activeTabSys, activeTabSnapshot]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        const weekly = await apiFetch<{
          week_start: string;
          week_end: string;
          snapshot: WeeklySnapshot;
        }>("/api/weekly");

        const metrics = await apiFetch<{ items: LatestMetricRow[] }>("/api/metrics/latest");
        const lu = await apiFetch<{ items: SystemLastUpdated[] }>("/api/systems/last-updated");
        const h = await apiFetch<{ items: HistoryApiRow[] }>("/api/history?limit=3");

        const ws = weekly?.week_start || null;
        const we = weekly?.week_end || null;

        const focus = ws ? await apiFetch<FocusWeekResponse>(`/api/focus?week_start=${ws}`) : null;

        if (!alive) return;

        setSnapshot(weekly?.snapshot ?? getDefaultSnapshot());
        setWeekStart(ws);
        setWeekEnd(we);

        setLatestMetrics(metrics?.items ?? []);
        setLastUpdated(lu?.items ?? []);
        setHistory3(h?.items ?? []);
        setFocusWeek(focus ?? null);

        setLoadError(null);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "Failed to load dashboard data";
        setLoadError(msg);

        setSnapshot(getDefaultSnapshot());
        setWeekStart(null);
        setWeekEnd(null);

        setLatestMetrics([]);
        setLastUpdated([]);
        setHistory3([]);
        setFocusWeek(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /* ----------------------------------------
     Core system headline percents
  ---------------------------------------- */
  const percentLacdrop = useMemo(() => {
    const snap = snapshot.categories.find((c) => c.name === "LACdrop");
    return resolveLivePercent("LACdrop", liveMap, snap?.focusPercent);
  }, [snapshot.categories, liveMap]);

  const percentToddleParent = useMemo(() => {
    const snap = snapshot.categories.find((c) => c.name === "Toddle Parent");
    return resolveLivePercent("Toddle Parent", liveMap, snap?.focusPercent);
  }, [snapshot.categories, liveMap]);

  const percentAttendance = useMemo(() => {
    const snap = snapshot.categories.find((c) => c.name === "Staff Attendance");
    return resolveLivePercent("Staff Attendance", liveMap, snap?.focusPercent);
  }, [snapshot.categories, liveMap]);

  const percentMDM = useMemo(() => {
    const snap = snapshot.categories.find((c) => c.name === "MDM");
    return resolveLivePercent("MDM", liveMap, snap?.focusPercent);
  }, [snapshot.categories, liveMap]);

  const totalSystems = snapshot.categories.length || 1;

  const stableCount = useMemo(
    () => snapshot.categories.filter((c) => c.status === "STABLE").length,
    [snapshot.categories]
  );
  const attentionCount = useMemo(
    () => snapshot.categories.filter((c) => c.status === "ATTENTION").length,
    [snapshot.categories]
  );
  const criticalCount = useMemo(
    () => snapshot.categories.filter((c) => c.status === "CRITICAL").length,
    [snapshot.categories]
  );

  const thisWeekOverall = useMemo(() => {
    const stabilityPct = Math.round((stableCount / totalSystems) * 100);
    const adoptionAvg = Math.round((percentLacdrop + percentToddleParent + percentAttendance) / 3);
    return Math.round(stabilityPct * 0.6 + adoptionAvg * 0.4);
  }, [stableCount, totalSystems, percentLacdrop, percentToddleParent, percentAttendance]);

  const lastWeekOverall = useMemo(() => {
    const v = (snapshot as any)?.metrics?.lastWeekOverallPercent;
    if (typeof v === "number") return clampPercent(v);
    return Math.max(0, thisWeekOverall - 3);
  }, [snapshot, thisWeekOverall]);

  const overallDelta = thisWeekOverall - lastWeekOverall;

  /* ----------------------------------------
     Strategic Focus (from backend)
  ---------------------------------------- */
  const focusItems = useMemo(() => {
    const items = focusWeek?.items || [];
    return [...items].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [focusWeek]);

  const showStrategicFocus = focusItems.length > 0;

  /* ----------------------------------------
     MDM quick numbers
  ---------------------------------------- */
  const mdmDex = useMemo(() => {
    const sys = liveMap.get("MDM") || {};
    const dex = sys["dex_attempts"]?.metric_value;
    return typeof dex === "number" ? Math.round(dex) : null;
  }, [liveMap]);

  const mdmConfiscated = useMemo(() => {
    const sys = liveMap.get("MDM") || {};
    const v = sys["devices_confiscated"]?.metric_value;
    return typeof v === "number" ? Math.round(v) : null;
  }, [liveMap]);

  /* ----------------------------------------
     Overall Trend (3 weeks)
  ---------------------------------------- */
  const overall3WeekTrend = useMemo(() => {
    if (!history3.length) {
      return {
        labels: ["Last Week", "This Week"],
        datasets: [
          {
            label: "Overall Digital Health",
            data: [lastWeekOverall, thisWeekOverall],
            tension: 0.35,
            fill: true,
            pointRadius: 4,
          },
        ],
      };
    }

    const sorted = [...history3].sort((a, b) => {
      const ta = a.week_start ? new Date(a.week_start).getTime() : 0;
      const tb = b.week_start ? new Date(b.week_start).getTime() : 0;
      return ta - tb;
    });

    const labels = sorted.map((r) => formatWeekLabel(r.week_start, r.week_end));
    const values = sorted.map((r) => deriveOverallFromSnapshot(r.snapshot_json));

    return {
      labels,
      datasets: [
        {
          label: "Overall Digital Health",
          data: values,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        },
      ],
    };
  }, [history3, lastWeekOverall, thisWeekOverall]);

  const overallTrendOptions: ChartOptions<"line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}%` } },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: (v) => `${v}%` },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        x: { grid: { display: false } },
      },
    }),
    []
  );

  /* ----------------------------------------
     Adoption snapshot bars (WITH COLORS)
  ---------------------------------------- */
  const adoptionBars = useMemo(
    () => ({
      labels: ["LACdrop", "Toddle Parent", "Staff Attendance", "MDM"],
      datasets: [
        {
          label: "Current (%)",
          data: [percentLacdrop, percentToddleParent, percentAttendance, percentMDM],
          backgroundColor: ["#2563EB", "#06B6D4", "#0EA5A4", "#F59E0B"], // ✅ colors back
          borderRadius: 12,
          borderSkipped: false,
        },
      ],
    }),
    [percentLacdrop, percentToddleParent, percentAttendance, percentMDM]
  );

  const adoptionBarOptions: ChartOptions<"bar"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}%` } },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: (v) => `${v}%` },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        x: { grid: { display: false } },
      },
    }),
    []
  );

  /* ----------------------------------------
     Delivery / Project Progress
     ✅ Hide section if no meaningful progress exists
  ---------------------------------------- */
  function findProgress(name: string) {
    const c = snapshot.categories.find((x) => x.name === name);
    return clampPercent(c?.focusPercent ?? 0);
  }

  const delivery = useMemo(() => {
    const raw = [
      {
        name: "Digital Dashboard",
        pct:
          findProgress("Digital Systems Dashboard") ||
          clampPercent((snapshot as any)?.metrics?.dashboard_progress),
      },
      { name: "Online Test", pct: findProgress("Online Test") },
      { name: "Student Badges", pct: clampPercent((snapshot as any)?.metrics?.badges_progress ?? 0) },
    ];

    // Keep only meaningful values (strict: > 0)
    return raw.filter((d) => Number(d.pct) > 0);
  }, [snapshot]);

  const showDelivery = delivery.length > 0;

  const pageWeekLabel = useMemo(() => {
    if (weekStart && weekEnd) return formatWeekLabel(weekStart, weekEnd);
    return snapshot.weekLabel || "—";
  }, [weekStart, weekEnd, snapshot.weekLabel]);

  return (
    <AppShell>
      <div className="space-y-8">
        {/* =========================
            HEADER
        ========================== */}
        <section className="space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
              <p className="text-sm text-gray-600">{pageWeekLabel}</p>

              {loading ? (
                <p className="text-xs text-gray-500">Loading executive metrics…</p>
              ) : loadError ? (
                <p className="text-xs text-amber-700">Using fallback data (API error).</p>
              ) : (
                <p className="text-xs text-gray-500">
                  Last refresh:{" "}
                  <span className="font-semibold text-gray-700">
                    {niceTimeAgo(lastUpdated[0]?.last_updated || null)}
                  </span>
                </p>
              )}
            </div>

            <div className="rounded-2xl border bg-white px-4 py-3">
              <div className="text-xs font-semibold text-gray-600">Overall score method</div>
              <div className="mt-1 text-xs text-gray-500">60% stability + 40% adoption average</div>
            </div>
          </div>
        </section>

        {/* =========================
            1) EXECUTIVE SUMMARY STRIP
        ========================== */}
        <section>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Overall Digital Health</p>
              <div className="mt-2 flex items-end justify-between">
                <p className="text-3xl font-bold text-gray-900">{thisWeekOverall}%</p>
                <span className="text-xs font-semibold text-gray-600">Δ {deltaText(overallDelta)}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">Based on system stability + user adoption</p>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Systems Stable</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {stableCount} <span className="text-gray-400">/ {totalSystems}</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Attention: <span className="font-semibold">{attentionCount}</span> • Critical:{" "}
                <span className="font-semibold">{criticalCount}</span>
              </p>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Follow-up Items</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{criticalCount + attentionCount}</p>
              <p className="mt-1 text-xs text-gray-500">Items needing review this week</p>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Parent Adoption (LACdrop)</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{percentLacdrop}%</p>
              <p className="mt-1 text-xs text-gray-500">Current adoption level</p>
            </div>
          </div>
        </section>

        {/* =========================
            2) LIVE APP METRICS (RAW NUMBERS)
        ========================== */}
        <section className="rounded-2xl border bg-white p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Live App Metrics</h2>
              <p className="text-sm text-gray-600">
                Raw figures + percent (API-ready). This is the “numbers view” for leadership.
              </p>
            </div>

            <div className="text-xs text-gray-500">
              Last refresh:{" "}
              <span className="font-semibold text-gray-700">
                {niceTimeAgo(lastUpdatedMap.get(activeAppTab) || null)}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {CORE_APPS.map((name) => {
              const isActive = name === activeAppTab;
              return (
                <button
                  key={name}
                  onClick={() => setActiveAppTab(name)}
                  className={
                    isActive
                      ? "rounded-full border bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
                      : "rounded-full border bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  }
                >
                  {name}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border bg-white p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-bold text-gray-900">{activeAppTab}</h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${activeTabStatus.cls}`}
                  >
                    {activeTabStatus.label}
                  </span>
                </div>

                <div className="mt-2 text-sm text-gray-600">
                  Last updated:{" "}
                  <span className="font-semibold text-gray-900">
                    {niceTimeAgo(lastUpdatedMap.get(activeAppTab) || null)}
                  </span>
                </div>

                <div className="mt-5 text-sm text-gray-700">
                  <div className="font-semibold text-gray-900">
                    {activeAppTab === "MDM"
                      ? "Coverage / Compliance"
                      : activeAppTab === "Staff Attendance"
                        ? "Adoption / Usage"
                        : activeAppTab === "Online Test"
                          ? "Progress"
                          : "Adoption / Usage"}
                    :{" "}
                    <span className="font-bold">
                      {activeTabPair.a !== null && activeTabPair.b !== null
                        ? `${activeTabPair.a}/${activeTabPair.b}`
                        : "—"}
                    </span>
                  </div>

                  <div className="mt-2 text-sm text-gray-700">
                    {activeTabPair.a !== null && activeTabPair.b !== null ? (
                      <span className="text-gray-600">
                        <span className="font-semibold text-gray-800">{activeTabPair.labelA}</span>{" "}
                        / <span className="font-semibold text-gray-800">{activeTabPair.labelB}</span>
                      </span>
                    ) : (
                      <span className="text-gray-500">
                        Tip: provide meta {"{active,total}"} or matching metric keys.
                      </span>
                    )}
                  </div>

                  {activeTabNote ? (
                    <div className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-1">📌</span>
                      <p className="min-w-0">{activeTabNote}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="shrink-0">
                <PercentRing value={activeTabPercent} colorClass={ringColorForSystem(activeAppTab)} />
              </div>
            </div>
          </div>
        </section>

        {/* =========================
            3) STRATEGIC FOCUS
        ========================== */}
        {showStrategicFocus ? (
          <section className="rounded-2xl border bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Strategic Focus</h2>
                <p className="text-sm text-gray-600">
                  Leadership focus items (entered in Updates as <span className="font-semibold">FOCUS</span>).
                </p>
              </div>

              <div className="text-xs text-gray-500">
                Week:{" "}
                <span className="font-semibold text-gray-700">
                  {focusWeek?.weekLabel || pageWeekLabel}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border bg-gray-50 p-4 lg:col-span-2">
                <div className="space-y-3">
                  {focusItems.map((it) => (
                    <div key={it.id} className="rounded-xl border bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {it.system_key}: {it.title}
                          </p>
                          <p className="mt-1 text-sm text-gray-700">{it.details}</p>
                          <p className="mt-2 text-xs text-gray-500">
                            {it.date} • {new Date(it.created_at).toLocaleString()}
                          </p>
                        </div>

                        <div className="text-right text-xs text-gray-500">
                          <div className="font-semibold text-gray-700">Updated</div>
                          <div>{niceTimeAgo(lastUpdatedMap.get(it.system_key) || null)}</div>
                        </div>
                      </div>

                      {it.system_key === "MDM" ? (
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border bg-gray-50 p-3">
                            <p className="text-xs font-semibold text-gray-600">MDM Compliance</p>
                            <p className="mt-1 text-xl font-bold text-gray-900">{percentMDM}%</p>
                          </div>
                          <div className="rounded-xl border bg-gray-50 p-3">
                            <p className="text-xs font-semibold text-gray-600">DeX Attempts</p>
                            <p className="mt-1 text-xl font-bold text-gray-900">{mdmDex ?? "—"}</p>
                          </div>
                          <div className="rounded-xl border bg-gray-50 p-3">
                            <p className="text-xs font-semibold text-gray-600">Devices Confiscated</p>
                            <p className="mt-1 text-xl font-bold text-gray-900">{mdmConfiscated ?? "—"}</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <p className="text-sm font-semibold text-gray-900">Suggested Actions</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-gray-700">
                  <li>Confirm weekly priorities with leadership.</li>
                  <li>Assign owners for each focus item.</li>
                  <li>Review progress mid-week using Updates.</li>
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        {/* =========================
            4) TRENDS
        ========================== */}
        <section>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border bg-white p-6 lg:col-span-1">
              <h3 className="font-semibold text-gray-900">Overall Trend</h3>
              <p className="mb-3 text-xs text-gray-500">Last 3 weeks</p>
              <div className="h-[220px]">
                <Line data={overall3WeekTrend} options={overallTrendOptions} />
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-6 lg:col-span-2">
              <h3 className="font-semibold text-gray-900">Adoption & Compliance Snapshot</h3>
              <p className="mb-3 text-xs text-gray-500">Current week percentages</p>
              <div className="h-[220px]">
                <Bar data={adoptionBars} options={adoptionBarOptions} />
              </div>
            </div>
          </div>
        </section>

        {/* =========================
            5) DELIVERY / PROJECT PROGRESS
            ✅ Only render if delivery exists
        ========================== */}
        {showDelivery ? (
          <section className="rounded-2xl border bg-white p-6">
            <h2 className="text-lg font-bold text-gray-900">Delivery Progress</h2>
            <p className="text-sm text-gray-600">Key initiatives nearing completion.</p>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              {delivery.map((d) => {
                const pct = clampPercent(d.pct);
                return (
                  <div key={d.name} className="rounded-2xl border bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-900">{d.name}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">{pct}%</p>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div className="h-2 rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-gray-500">Progress to completion</p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* =========================
            OUTRO
        ========================== */}
        <section className="rounded-2xl border bg-white p-6">
          <h2 className="mb-2 font-bold text-gray-900">Next Focus</h2>
          <p className="text-sm text-gray-700">
            Use Updates daily, then run the weekly rollup at week end so the dashboard stays consistent for leadership.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
