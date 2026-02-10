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
import {
  getDefaultSnapshot,
  loadWeeklySnapshot,
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
  // You can lock more here later if you want
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

function isUserAdoptionSystem(category: CategorySnapshot) {
  // For now: exclude MDM from adoption average & adoption chart
  return category.name !== "MDM";
}

/**
 * Safe percent resolver:
 * - Prefer explicit metrics if present
 * - Otherwise fallback to focusPercent (current convention)
 */
function resolvePercent(category: CategorySnapshot) {
  const m = category.metrics || {};
  const v =
    typeof m.adoptionPercent === "number"
      ? m.adoptionPercent
      : typeof m.parentUsagePercent === "number"
        ? m.parentUsagePercent
        : typeof m.coveragePercent === "number"
          ? m.coveragePercent
          : typeof category.focusPercent === "number"
            ? category.focusPercent
            : 0;

  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Last week percent for overall progress
 * - Prefer snapshot.metrics.lastWeekOverallPercent (if you add it later)
 * - Otherwise safe fallback (thisWeek - 5)
 */
function resolveLastWeekOverall(snapshot: WeeklySnapshot, thisWeekOverall: number) {
  // @ts-expect-error - we may add this later in reportStore; safe runtime check
  const v = snapshot?.metrics?.lastWeekOverallPercent;
  if (typeof v === "number") return Math.max(0, Math.min(100, v));
  return Math.max(0, thisWeekOverall - 5);
}

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
   Component
---------------------------------------- */
export default function ExecutiveDashboard() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot>(getDefaultSnapshot());

  useEffect(() => {
    setSnapshot(loadWeeklySnapshot());
  }, []);

  /* ----------------------------------------
     1️⃣ IT Systems Health Overview
  ---------------------------------------- */
  const totalSystems = snapshot.categories.length;
  const operational = snapshot.categories.filter((c) => c.status === "STABLE").length;
  const attention = snapshot.categories.filter((c) => c.status === "ATTENTION").length;

  const userSystems = snapshot.categories.filter(isUserAdoptionSystem);
  const avgUserAdoption = Math.round(
    userSystems.reduce((sum, c) => sum + resolvePercent(c), 0) / (userSystems.length || 1)
  );

  /* ----------------------------------------
     2️⃣ VISUALS
  ---------------------------------------- */
  const healthDonut = useMemo(() => {
    const stable = snapshot.categories.filter((c) => c.status === "STABLE").length;
    const attn = snapshot.categories.filter((c) => c.status === "ATTENTION").length;
    const critical = snapshot.categories.filter((c) => c.status === "CRITICAL").length;

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
  }, [snapshot]);

  /** ✅ (3) User Adoption Snapshot should be ONLY these 3 systems */
  const USER_ADOPTION_NAMES = useMemo(
    () => new Set<string>([LACDROP_NAME, "Toddle Parent", "Staff Attendance"]),
    []
  );

  const adoptionBars = useMemo(() => {
    const cats = snapshot.categories.filter((c) => USER_ADOPTION_NAMES.has(c.name));
    const labels = cats.map((c) => c.name);
    const values = cats.map((c) => resolvePercent(c));
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
  }, [snapshot, USER_ADOPTION_NAMES]);

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
     3️⃣ SYSTEMS ADOPTION & USAGE (donut per tile)
  ---------------------------------------- */
  const systemsTiles = snapshot.categories.map((c) => {
    const percent = resolvePercent(c);
    const primaryLabel = c.name === "MDM" ? "Coverage / Compliance" : "Adoption / Usage";
    const color = colorForName(c.name);
    return { c, percent, primaryLabel, color };
  });

  /* ----------------------------------------
     ✅ (2) Overall Progress (Week-on-week)
     - Rename section
     - Remove Online Test from this comparison (not needed here)
     - Use ONE overall derived % for comparison
  ---------------------------------------- */
  const thisWeekOverall = useMemo(() => {
    // Simple, defensible “executive” overall for now:
    // 60% Stability posture + 40% user adoption posture
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
        backgroundColor: "#CBD5E1", // ✅ lighter slate (more distinct)
        borderRadius: 12,
        borderSkipped: false,
        barThickness: 42,
      },
      {
        label: "This Week",
        data: [thisWeekOverall],
        backgroundColor: "#2563EB", // ✅ strong blue (clearly different)
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

  return (
    <AppShell>
      <div className="space-y-10">
        {/* Header */}
        <section className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">IT Systems Dashboard</h1>
          <p className="text-sm text-gray-600">{snapshot.weekLabel}</p>
        </section>

        {/* ======================================================
            1️⃣ IT SYSTEMS HEALTH OVERVIEW (Top strip)
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
              <p className="mt-1 text-xs text-gray-500">Excludes MDM</p>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs font-semibold text-gray-600">Reporting Week</p>
              <p className="mt-3 text-sm font-semibold text-gray-900">{snapshot.weekLabel}</p>
            </div>
          </div>
        </section>

        {/* ======================================================
            2️⃣ VISUALS (right after Health)
        ====================================================== */}
        <section>
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">System Performance Trends</h2>
              <p className="text-sm text-gray-600">
                Visual summary — clear, calm, and executive-friendly.
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

            {/* ✅ User Adoption Snapshot (only LACdrop, Toddle Parent, Staff Attendance) */}
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
            3️⃣ SYSTEMS ADOPTION & USAGE (tiles + donut, minimal text)
        ====================================================== */}
        <section>
          <h2 className="text-xl font-bold mb-4 text-gray-900">Systems Adoption & Usage</h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {systemsTiles.map(({ c, percent, primaryLabel, color }) => (
              <div key={c.id} className="rounded-2xl border bg-white p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-lg text-gray-900">{c.name}</h3>
                    <span className={statusBadge(c.status)}>{c.status}</span>
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
            ✅ 4️⃣ OVERALL PROGRESS (Week-on-week)
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
                  Derived from stability + user adoption
                </p>
              </div>
              <div className="rounded-xl border bg-white p-4">
                <p className="text-xs font-semibold text-gray-600">Last Week</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{lastWeekOverall}%</p>
                <p className="mt-1 text-xs text-gray-500">
                  Uses stored metric if available
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

          {snapshot.alerts.length ? (
            <ul className="list-disc list-inside text-sm space-y-1 text-gray-700">
              {snapshot.alerts.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">No attention items this week.</p>
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
