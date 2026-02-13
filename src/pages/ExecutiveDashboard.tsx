import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import {
  getDefaultSnapshot,
  type WeeklySnapshot,
  type CategorySnapshot,
} from "../lib/reportStore";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

/* ----------------------------------------
   Executive palette (inspired by your reference image)
---------------------------------------- */
const PALETTE = [
  "#2F6FED", // blue
  "#0EA5A4", // teal
  "#F59E0B", // amber
  "#8B5CF6", // purple
  "#22C55E", // green
  "#64748B", // slate
  "#06B6D4", // cyan
  "#A855F7", // violet
];

const LACDROP_NAME = "LACdrop";

/** Force key systems to specific colors (so we don’t accidentally use “critical red”) */
const FIXED_COLORS: Record<string, string> = {
  [LACDROP_NAME]: "#2F6FED", // ✅ not red
};

function hashToIndex(input: string, mod: number) {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % mod;
}

function colorForName(name: string) {
  const fixed = FIXED_COLORS[name];
  if (fixed) return fixed;
  return PALETTE[hashToIndex(name, PALETTE.length)];
}

/* ----------------------------------------
   Types for NEW endpoints
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

type FeedItem = {
  id: string;
  date: string;
  system_key: string;
  title: string;
  details: string;
  created_at: string;
};

type SystemLastUpdated = {
  system_key: string;
  last_updated: string;
};

/* ----------------------------------------
   Helpers
---------------------------------------- */
function statusBadge(status: CategorySnapshot["status"]) {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border";
  if (status === "STABLE")
    return `${base} bg-green-50 text-green-800 border-green-200`;
  if (status === "ATTENTION")
    return `${base} bg-amber-50 text-amber-800 border-amber-200`;
  return `${base} bg-red-50 text-red-800 border-red-200`;
}

//function isUserAdoptionSystem(category: CategorySnapshot) {
  // For now: exclude MDM from adoption average & adoption chart
  //return category.name !== "MDM";
//}

function clampPercent(v: any) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * LAST WEEK overall resolver:
 * - Prefer snapshot.metrics.lastWeekOverallPercent (if rollup stores it)
 * - Otherwise safe fallback (thisWeek - 5)
 */
function resolveLastWeekOverall(snapshot: WeeklySnapshot, thisWeekOverall: number) {
  const v = (snapshot as any)?.metrics?.lastWeekOverallPercent;

  if (typeof v === "number") return clampPercent(v);
  return Math.max(0, thisWeekOverall - 5);
}

/**
 * Insight stays: we’ll still show calm summaries
 */
function generateInsight(category: CategorySnapshot) {
  if (category.name === "MDM") {
    return "📌 Bypass attempts are mainly via Samsung DeX. Monitoring + discipline reporting are active.";
  }
  if (category.name === "LACdrop") {
    return "📌 Parent onboarding support is improving usage. Teacher usage remains compliant.";
  }
  if (category.name === "Online Test") {
    return "📌 Core features are close. Final validation is the remaining blocker.";
  }
  return category.notes || "📌 System operating within expected parameters.";
}

/* ----------------------------------------
   Mini donut for each system tile
---------------------------------------- */
function MiniDonut({ percent, color }: { percent: number; color: string }) {
  const data = useMemo(
    () => ({
      labels: ["Done", "Gap"],
      datasets: [
        {
          data: [percent, Math.max(0, 100 - percent)],
          backgroundColor: [color, "#E5E7EB"],
          borderWidth: 0,
        },
      ],
    }),
    [percent, color]
  );

  const options: ChartOptions<"doughnut"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "76%",
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    }),
    []
  );

  return (
    <div className="relative h-[110px] w-[110px]">
      <Doughnut data={data} options={options} />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl font-bold text-gray-900">{percent}%</div>
          <div className="text-[10px] font-semibold text-gray-500">Complete</div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------
   LIVE metric mapping
   - Convert latest_system_metrics rows to { [system]: { [metric_key]: value } }
---------------------------------------- */
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
 * Decide which metric drives the system percent (used in donut + charts):
 * - MDM: coverage_percent
 * - LACdrop/Toddle: adoption_percent
 * - Staff Attendance: usage_percent
 * - Online Test: progress_percent
 * fallback: snapshot focusPercent
 */
function resolveLivePercent(
  systemName: string,
  liveMap: Map<string, Record<string, LatestMetricRow>>,
  snapshotCategory?: CategorySnapshot
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

  // fallback to snapshot
  if (snapshotCategory) return clampPercent(snapshotCategory.focusPercent);
  return 0;
}

function resolveLiveStatus(
  systemName: string,
  liveMap: Map<string, Record<string, LatestMetricRow>>,
  snapshotCategory?: CategorySnapshot
): CategorySnapshot["status"] {
  const sys = liveMap.get(systemName) || {};

  // Rule 1: explicit health_code in metrics (1 stable, 2 attention, 3 critical)
  const hc = sys["health_code"]?.metric_value;
  if (hc === 3) return "CRITICAL";
  if (hc === 2) return "ATTENTION";
  if (hc === 1) return "STABLE";

  // Rule 2: MDM DeX attempts > 0 => ATTENTION
  if (systemName === "MDM") {
    const dex = sys["dex_attempts"]?.metric_value;
    if (typeof dex === "number" && dex > 0) return "ATTENTION";
  }

  // fallback to snapshot status
  return snapshotCategory?.status || "STABLE";
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

/* ----------------------------------------
   Component
---------------------------------------- */
export default function ExecutiveDashboard() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot>(getDefaultSnapshot());

  // ✅ live data
  const [latestMetrics, setLatestMetrics] = useState<LatestMetricRow[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<SystemLastUpdated[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        // 1) weekly snapshot (fallback + last week metrics)
        const weekly = await apiFetch<{
          week_start: string;
          week_end: string;
          snapshot: WeeklySnapshot;
        }>("/api/weekly");

        // 2) live metrics
        const metrics = await apiFetch<{ items: LatestMetricRow[] }>("/api/metrics/latest");

        // 3) live feed
        const feedRes = await apiFetch<{ items: FeedItem[] }>("/api/feed?limit=10");

        // 4) last updated per system
        const lu = await apiFetch<{ items: SystemLastUpdated[] }>("/api/systems/last-updated");

        if (!alive) return;

        setSnapshot(weekly?.snapshot ?? getDefaultSnapshot());
        setLatestMetrics(metrics?.items ?? []);
        setFeed(feedRes?.items ?? []);
        setLastUpdated(lu?.items ?? []);

        setLoadError(null);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "Failed to load dashboard data";
        setLoadError(msg);

        // keep UI usable
        setSnapshot(getDefaultSnapshot());
        setLatestMetrics([]);
        setFeed([]);
        setLastUpdated([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /* ----------------------------------------
     LIVE maps
  ---------------------------------------- */
  const liveMap = useMemo(() => buildLiveMap(latestMetrics), [latestMetrics]);

  const lastUpdatedMap = useMemo(() => {
    const m = new Map<string, string>();
    (lastUpdated || []).forEach((r) => m.set(r.system_key, r.last_updated));
    return m;
  }, [lastUpdated]);

  /* ----------------------------------------
     Systems list (from snapshot, but we’ll render with live)
  ---------------------------------------- */
  const systemsTiles = useMemo(() => {
    return snapshot.categories.map((c) => {
      const percent = resolveLivePercent(c.name, liveMap, c);
      const status = resolveLiveStatus(c.name, liveMap, c);
      const primaryLabel = c.name === "MDM" ? "Coverage / Compliance" : "Adoption / Usage";
      const color = colorForName(c.name);
      const freshness = niceTimeAgo(lastUpdatedMap.get(c.name) || null);
      return { c: { ...c, status }, percent, primaryLabel, color, freshness };
    });
  }, [snapshot.categories, liveMap, lastUpdatedMap]);

  /* ----------------------------------------
     1️⃣ IT Systems Health Overview (LIVE first)
  ---------------------------------------- */
  const totalSystems = snapshot.categories.length;

  const operational = useMemo(
    () => systemsTiles.filter((x) => x.c.status === "STABLE").length,
    [systemsTiles]
  );
  const attention = useMemo(
    () => systemsTiles.filter((x) => x.c.status === "ATTENTION").length,
    [systemsTiles]
  );

  const avgUserAdoption = useMemo(() => {
    const userCats = systemsTiles.filter((x) => x.c.name !== "MDM");
    return Math.round(
      userCats.reduce((sum, x) => sum + clampPercent(x.percent), 0) / (userCats.length || 1)
    );
  }, [systemsTiles]);

  /* ----------------------------------------
     2️⃣ VISUALS (LIVE first)
  ---------------------------------------- */
  const healthDonut = useMemo(() => {
    const stable = systemsTiles.filter((c) => c.c.status === "STABLE").length;
    const attn = systemsTiles.filter((c) => c.c.status === "ATTENTION").length;
    const critical = systemsTiles.filter((c) => c.c.status === "CRITICAL").length;

    return {
      labels: ["Stable", "Attention", "Critical"],
      datasets: [
        {
          data: [stable, attn, critical],
          backgroundColor: ["#22C55E", "#F59E0B", "#EF4444"],
          borderWidth: 0,
        },
      ],
    };
  }, [systemsTiles]);

  /** User Adoption Snapshot names */
  const USER_ADOPTION_NAMES = useMemo(
    () => new Set<string>([LACDROP_NAME, "Toddle Parent", "Staff Attendance"]),
    []
  );

  const adoptionBars = useMemo(() => {
    const cats = snapshot.categories.filter((c) => USER_ADOPTION_NAMES.has(c.name));
    const labels = cats.map((c) => c.name);
    const values = labels.map((name) => {
      const snapCat = snapshot.categories.find((c) => c.name === name);
      return resolveLivePercent(name, liveMap, snapCat);
    });
    const colors = labels.map((n) => colorForName(n));

    return {
      labels,
      datasets: [
        {
          label: "Adoption / Usage (%)",
          data: values,
          backgroundColor: colors,
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    };
  }, [snapshot.categories, USER_ADOPTION_NAMES, liveMap]);

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
     Overall Progress (Week-on-week)
     - This remains weekly logic (executive view)
     - We keep it stable even if live metrics are missing
  ---------------------------------------- */
  const thisWeekOverall = useMemo(() => {
    const stabilityPct = Math.round((operational / (totalSystems || 1)) * 100);
    const adoptionPct = avgUserAdoption;
    return Math.round(stabilityPct * 0.6 + adoptionPct * 0.4);
  }, [operational, totalSystems, avgUserAdoption]);

  const lastWeekOverall = useMemo(
    () => resolveLastWeekOverall(snapshot, thisWeekOverall),
    [snapshot, thisWeekOverall]
  );

  const overallGrouped = useMemo(() => {
    return {
      labels: ["Overall Progress"],
      datasets: [
        {
          label: "Last Week",
          data: [lastWeekOverall],
          backgroundColor: "#94A3B8", // changed a bit so it’s not identical
          borderRadius: 12,
          borderSkipped: false,
          barThickness: 42,
        },
        {
          label: "This Week",
          data: [thisWeekOverall],
          backgroundColor: "#2563EB",
          borderRadius: 12,
          borderSkipped: false,
          barThickness: 42,
        },
      ],
    };
  }, [lastWeekOverall, thisWeekOverall]);

  const overallGroupedOptions: ChartOptions<"bar"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%` } },
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
     Alerts & Live Feed
  ---------------------------------------- */
  const attentionItems = useMemo(() => {
    // prefer live feed titles as “attention” highlights if available
    // fallback to snapshot alerts
    if (feed.length) {
      // take top 6 concise lines
      return feed.slice(0, 6).map((f) => `${f.system_key}: ${f.title}`);
    }
    return snapshot.alerts || [];
  }, [feed, snapshot.alerts]);

  return (
    <AppShell>
      <div className="space-y-10">
        {/* Header */}
        <section className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">IT Systems Dashboard</h1>
              <p className="text-sm text-gray-600">{snapshot.weekLabel}</p>
              {loading ? (
                <p className="text-xs text-gray-500">Loading live metrics + feed…</p>
              ) : loadError ? (
                <p className="text-xs text-amber-700">Using fallback data (API error).</p>
              ) : null}
            </div>

            {/* Global freshness hint */}
            <div className="rounded-2xl border bg-white px-4 py-3">
              <div className="text-xs font-semibold text-gray-600">Live Feed</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">
                {feed[0]?.created_at ? niceTimeAgo(feed[0].created_at) : "—"}
              </div>
              <div className="mt-1 text-xs text-gray-500">latest update</div>
            </div>
          </div>
        </section>

        {/* ======================================================
            1️⃣ IT SYSTEMS HEALTH OVERVIEW
        ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            IT Systems Health Overview
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Systems Operational</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {operational} <span className="text-gray-400">/ {totalSystems}</span>
              </p>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Needs Attention</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{attention}</p>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">User Systems Adoption</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{avgUserAdoption}%</p>
              <p className="mt-1 text-xs text-gray-500">Live metrics • excludes MDM</p>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Reporting Week</p>
              <p className="mt-3 text-sm font-semibold text-gray-900">{snapshot.weekLabel}</p>
            </div>
          </div>
        </section>

        {/* ======================================================
            2️⃣ VISUALS
        ====================================================== */}
        <section>
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">System Performance Trends</h2>
              <p className="text-sm text-gray-600">
                Live metrics drive these charts. Weekly snapshot is fallback.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Health Distribution */}
            <div className="rounded-2xl border bg-white p-6">
              <h3 className="font-semibold text-gray-900">Health Distribution</h3>
              <p className="text-xs text-gray-500 mb-3">Stable vs Attention vs Critical</p>
              <div className="h-[240px]">
                <Doughnut
                  data={healthDonut}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "68%",
                    plugins: { legend: { position: "bottom" } },
                  }}
                />
              </div>
            </div>

            {/* User Adoption Snapshot */}
            <div className="rounded-2xl border bg-white p-6 lg:col-span-2">
              <h3 className="font-semibold text-gray-900">User Adoption Snapshot</h3>
              <p className="text-xs text-gray-500 mb-3">
                LACdrop • Toddle Parent • Staff Attendance
              </p>
              <div className="h-[240px]">
                <Bar data={adoptionBars} options={adoptionBarOptions} />
              </div>
            </div>
          </div>
        </section>

        {/* ======================================================
            LIVE FEED PANEL (NEW)
        ====================================================== */}
        <section className="rounded-2xl border bg-white p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Live Feed</h2>
              <p className="text-sm text-gray-600">Latest updates (like executive news).</p>
            </div>
            <div className="text-xs text-gray-500">
              {feed[0]?.created_at ? `Updated ${niceTimeAgo(feed[0].created_at)}` : "No updates yet"}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {feed.length ? (
              feed.slice(0, 8).map((f) => (
                <div key={f.id} className="rounded-xl border bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {f.system_key}: {f.title}
                      </div>
                      <div className="mt-1 text-sm text-gray-700">{f.details}</div>
                      <div className="mt-2 text-xs text-gray-500">
                        {f.date} • {new Date(f.created_at).toLocaleString()}
                      </div>
                    </div>
                    <span className="rounded-full border px-3 py-1 text-xs font-semibold text-gray-700">
                      {niceTimeAgo(f.created_at)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-600">No live updates yet. Add entries in the Updates page.</p>
            )}
          </div>
        </section>

        {/* ======================================================
            3️⃣ SYSTEMS ADOPTION & USAGE
        ====================================================== */}
        <section>
          <h2 className="text-xl font-bold mb-4 text-gray-900">Systems Adoption & Usage</h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {systemsTiles.map(({ c, percent, primaryLabel, color, freshness }) => (
              <div key={c.id} className="rounded-2xl border bg-white p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg text-gray-900">{c.name}</h3>
                      <span className={statusBadge(c.status)}>{c.status}</span>
                    </div>

                    <div className="text-xs text-gray-500">
                      Last updated:{" "}
                      <span className="font-semibold text-gray-700">{freshness}</span>
                    </div>
                  </div>

                  <MiniDonut percent={percent} color={color} />
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-sm text-gray-700">
                    {primaryLabel}: <strong>{percent}%</strong>
                  </p>
                  <p className="text-sm text-gray-600">{generateInsight(c)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ======================================================
            4️⃣ OVERALL PROGRESS
        ====================================================== */}
        <section>
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Overall Progress</h2>
              <p className="text-sm text-gray-600">Week-on-week comparison (monthly later)</p>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-6">
            <div className="h-[240px]">
              <Bar data={overallGrouped} options={overallGroupedOptions} />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border bg-white p-4">
                <p className="text-xs font-semibold text-gray-600">This Week</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{thisWeekOverall}%</p>
                <p className="mt-1 text-xs text-gray-500">
                  Derived from stability + live user adoption
                </p>
              </div>
              <div className="rounded-xl border bg-white p-4">
                <p className="text-xs font-semibold text-gray-600">Last Week</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{lastWeekOverall}%</p>
                <p className="mt-1 text-xs text-gray-500">
                  Uses stored weekly metric if available
                </p>
              </div>
              <div className="rounded-xl border bg-white p-4">
                <p className="text-xs font-semibold text-gray-600">Change</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {thisWeekOverall - lastWeekOverall >= 0 ? "+" : ""}
                  {thisWeekOverall - lastWeekOverall}%
                </p>
                <p className="mt-1 text-xs text-gray-500">Week-on-week delta</p>
              </div>
            </div>
          </div>
        </section>

        {/* ======================================================
            5️⃣ RISKS & ATTENTION
        ====================================================== */}
        <section className="rounded-2xl border bg-white p-6">
          <h2 className="font-bold mb-2 text-gray-900">Items Requiring Attention</h2>

          {attentionItems.length ? (
            <ul className="list-disc list-inside text-sm space-y-1 text-gray-700">
              {attentionItems.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">No attention items currently.</p>
          )}
        </section>

        {/* ======================================================
            6️⃣ WHAT’S NEXT
        ====================================================== */}
        <section className="rounded-2xl border bg-white p-6">
          <h2 className="font-bold mb-2 text-gray-900">What’s Next</h2>
          <p className="text-sm text-gray-700">
            Continue stabilizing priority systems, increase adoption for parent-facing tools,
            and complete final validations for active rollouts.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
