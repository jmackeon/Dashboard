import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import type { WeeklySnapshot } from "../lib/reportStore";
import { formatExecutiveWeekLabel } from "../lib/week";

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend);

type HistoryRow = {
  id: string;
  weekLabel: string;
  week_start?: string;
  week_end?: string;
  created_at?: string;

  status: "STABLE" | "ATTENTION" | "CRITICAL";

  overallPercent: number; // 0–100
  stableCount: number;
  totalSystems: number;

  highlights: string;
};

function clampPercent(v: any) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}

function statusBadge(status: HistoryRow["status"]) {
  const base = "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border";
  if (status === "STABLE") return `${base} bg-green-50 text-green-800 border-green-200`;
  if (status === "ATTENTION") return `${base} bg-amber-50 text-amber-800 border-amber-200`;
  return `${base} bg-red-50 text-red-800 border-red-200`;
}

function trendPill(delta: number) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border";
  if (delta > 0) return `${base} bg-green-50 text-green-800 border-green-200`;
  if (delta < 0) return `${base} bg-red-50 text-red-800 border-red-200`;
  return `${base} bg-gray-50 text-gray-700 border-gray-200`;
}

function deltaLabel(delta: number) {
  if (delta > 0) return `↑ +${delta}%`;
  if (delta < 0) return `↓ ${delta}%`;
  return "→ 0%";
}

/**
 * Old logic (snapshot_json compatibility)
 * Overall = 60% stability + 40% avg adoption (excluding MDM)
 */
function deriveOverallFromSnapshot(snapshot?: WeeklySnapshot) {
  const cats = snapshot?.categories || [];
  const total = cats.length || 1;

  const stable = cats.filter((c) => c.status === "STABLE").length;
  const stabilityPct = Math.round((stable / total) * 100);

  const userCats = cats.filter((c) => c.name !== "MDM");
  const adoptionAvg = Math.round(
    userCats.reduce((sum, c) => sum + clampPercent((c as any).focusPercent), 0) / (userCats.length || 1)
  );

  const overall = Math.round(stabilityPct * 0.6 + adoptionAvg * 0.4);
  return {
    overallPercent: clampPercent(overall),
    stableCount: stable,
    totalSystems: total,
  };
}

function deriveStatusFromSnapshot(snapshot?: WeeklySnapshot): HistoryRow["status"] {
  const cats = snapshot?.categories || [];
  const hasCritical = cats.some((c: any) => c.status === "CRITICAL");
  const hasAttention = cats.some((c: any) => c.status === "ATTENTION");
  return hasCritical ? "CRITICAL" : hasAttention ? "ATTENTION" : "STABLE";
}

function buildHighlightsFromSnapshot(snapshot?: WeeklySnapshot) {
  const cats = snapshot?.categories || [];
  const top = cats
    .slice(0, 4)
    .map((c: any) => {
      const p = clampPercent(c.focusPercent);
      const label =
        c.name === "MDM" ? "Compliance" :
        c.name === "Online Test" ? "Progress" :
        "Usage";
      return `${c.name}: ${p}% ${label}`;
    })
    .slice(0, 3);

  return top.length ? top.join(" • ") : "(no details)";
}

/**
 * New schema mapping (weekly_reports)
 * Expected fields:
 * - week_start, week_end
 * - executive_label (optional; we can regenerate)
 * - overall_percent
 * - systems_stable, systems_total
 * - status
 * Optional (if you include them later):
 * - highlights, or notes/system_metrics summary
 */
function mapFromWeeklyReportsRow(r: any): HistoryRow {
  const week_start = r.week_start ? String(r.week_start) : undefined;
  const week_end = r.week_end ? String(r.week_end) : undefined;

  const computedLabel =
    week_start && week_end ? formatExecutiveWeekLabel(week_start, week_end) : "(unknown week)";

  const weekLabel = String(r.executive_label || computedLabel);

  const overallPercent = clampPercent(r.overall_percent);
  const stableCount = Number(r.systems_stable ?? 0);
  const totalSystems = Number(r.systems_total ?? 0);

  const status: HistoryRow["status"] =
    r.status === "CRITICAL" || r.status === "ATTENTION" || r.status === "STABLE"
      ? r.status
      : "STABLE";

  const highlights =
    typeof r.highlights === "string" && r.highlights.trim()
      ? r.highlights.trim()
      : "(system breakdown available in details)";

  return {
    id: String(r.id),
    weekLabel,
    week_start,
    week_end,
    created_at: r.created_at ? String(r.created_at) : undefined,
    status,
    overallPercent,
    stableCount,
    totalSystems,
    highlights,
  };
}

export default function History() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"ALL" | HistoryRow["status"]>("ALL");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Keep your endpoint, but it should now return weekly_reports rows.
        // Backward-compatible: if it still returns snapshot_json, we still handle it.
        const res = await apiFetch<{ items: any[] }>("/api/history?limit=30");
        if (cancelled) return;

        const mapped: HistoryRow[] = (res.items || []).map((r) => {
          // If this is old storage, r.snapshot_json exists
          const snap: WeeklySnapshot | undefined = r.snapshot_json;

          // If it looks like weekly_reports row, use new mapping
          const hasNewSchema =
            r.week_start &&
            r.week_end &&
            (r.overall_percent !== undefined || r.systems_total !== undefined || r.executive_label);

          if (hasNewSchema) {
            return mapFromWeeklyReportsRow(r);
          }

          // Old behavior fallback
          const week_start = r.week_start ? String(r.week_start) : undefined;
          const week_end = r.week_end ? String(r.week_end) : undefined;

          const label =
            week_start && week_end
              ? formatExecutiveWeekLabel(week_start, week_end)
              : snap?.weekLabel || `${r.week_start}–${r.week_end}`;

          const { overallPercent, stableCount, totalSystems } = deriveOverallFromSnapshot(snap);
          const status = deriveStatusFromSnapshot(snap);
          const highlights = buildHighlightsFromSnapshot(snap);

          return {
            id: String(r.id),
            weekLabel: label,
            week_start,
            week_end,
            created_at: r.created_at ? String(r.created_at) : undefined,
            status,
            overallPercent,
            stableCount,
            totalSystems,
            highlights,
          };
        });

        // Sort newest first by week_start
        mapped.sort((a, b) => {
          const ta = a.week_start ? new Date(a.week_start).getTime() : 0;
          const tb = b.week_start ? new Date(b.week_start).getTime() : 0;
          return tb - ta;
        });

        setRows(mapped);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!s) return true;
      return r.weekLabel.toLowerCase().includes(s) || r.highlights.toLowerCase().includes(s);
    });
  }, [rows, statusFilter, q]);

  const kpis = useMemo(() => {
    const total = rows.length || 1;
    const stable = rows.filter((r) => r.status === "STABLE").length;
    const attn = rows.filter((r) => r.status === "ATTENTION").length;
    const crit = rows.filter((r) => r.status === "CRITICAL").length;
    const avgOverall = Math.round(rows.reduce((sum, r) => sum + r.overallPercent, 0) / total);
    return { total, stable, attn, crit, avgOverall };
  }, [rows]);

  const trend = useMemo(() => {
    // Oldest → newest on chart
    const chronological = [...filtered].reverse();
    const labels = chronological.map((r) => r.weekLabel);
    const values = chronological.map((r) => r.overallPercent);

    return {
      labels,
      datasets: [
        {
          label: "Overall Digital Health",
          data: values,
          borderColor: "#2563EB",
          backgroundColor: "rgba(37,99,235,0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 3,
        },
      ],
    };
  }, [filtered]);

  const trendOptions: ChartOptions<"line"> = useMemo(
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
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
      },
    }),
    []
  );

  const deltaMap = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const current = rows[i];
      const prev = rows[i + 1]; // older
      const delta = prev ? current.overallPercent - prev.overallPercent : 0;
      m.set(current.id, delta);
    }
    return m;
  }, [rows]);

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Header */}
        <section>
          <h1 className="text-2xl font-bold text-gray-900">History (Executive View)</h1>
          <p className="text-sm text-gray-600">Trend and summary of weekly IT system performance.</p>
          {loading ? <p className="mt-2 text-sm text-gray-500">Loading…</p> : null}
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </section>

        {/* KPI Strip */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border bg-white p-4">
            <p className="text-xs font-semibold text-gray-600">Weeks Tracked</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{kpis.total}</p>
          </div>
          <div className="rounded-2xl border bg-white p-4">
            <p className="text-xs font-semibold text-gray-600">Stable Weeks</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{kpis.stable}</p>
            <p className="mt-1 text-xs text-gray-500">
              Attention: {kpis.attn} • Critical: {kpis.crit}
            </p>
          </div>
          <div className="rounded-2xl border bg-white p-4">
            <p className="text-xs font-semibold text-gray-600">Average Overall</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{kpis.avgOverall}%</p>
          </div>
          <div className="rounded-2xl border bg-white p-4">
            <p className="text-xs font-semibold text-gray-600">Filter Applied</p>
            <p className="mt-3 text-sm font-semibold text-gray-900">
              {statusFilter === "ALL" ? "All statuses" : statusFilter}
            </p>
            <p className="mt-1 text-xs text-gray-500">{filtered.length} weeks shown</p>
          </div>
        </section>

        {/* Filters */}
        <section className="rounded-2xl border bg-white p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="rounded-xl border px-3 py-2 text-sm bg-white"
                >
                  <option value="ALL">All</option>
                  <option value="STABLE">Stable</option>
                  <option value="ATTENTION">Attention</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>

              <div className="min-w-[260px]">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Search</label>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search week or highlights…"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="text-xs text-gray-500">Tip: Use filters to view only “Attention/Critical” weeks.</div>
          </div>
        </section>

        {/* Trend */}
        <section className="rounded-2xl border bg-white p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Overall Performance Trend</h2>
              <p className="text-sm text-gray-600">Overall score over the selected weeks.</p>
            </div>
          </div>

          <div className="mt-4 h-[260px]">
            <Line data={trend} options={trendOptions} />
          </div>
        </section>

        {/* Executive Table */}
        <section className="rounded-2xl border bg-white p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Weekly Summary Table</h2>
              <p className="text-sm text-gray-600">Quick scan of scores, stability, risk, and highlights.</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-600">
                  <th className="py-2 pr-3">Week</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Overall</th>
                  <th className="py-2 pr-3">Δ</th>
                  <th className="py-2 pr-3">Stable Systems</th>
                  <th className="py-2 pr-3">Highlights</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {filtered.map((r) => {
                  const delta = deltaMap.get(r.id) ?? 0;
                  return (
                    <tr key={r.id} className="text-gray-800">
                      <td className="py-3 pr-3">
                        <div className="font-semibold">{r.weekLabel}</div>
                        {r.week_start && r.week_end ? (
                          <div className="text-xs text-gray-500">
                            {r.week_start} to {r.week_end}
                          </div>
                        ) : null}
                      </td>

                      <td className="py-3 pr-3">
                        <span className={statusBadge(r.status)}>{r.status}</span>
                      </td>

                      <td className="py-3 pr-3 font-semibold">{r.overallPercent}%</td>

                      <td className="py-3 pr-3">
                        <span className={trendPill(delta)}>{deltaLabel(delta)}</span>
                      </td>

                      <td className="py-3 pr-3">
                        {r.stableCount} / {r.totalSystems}
                      </td>

                      <td className="py-3 pr-3 text-gray-700">{r.highlights}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!filtered.length && !loading ? (
              <p className="mt-4 text-sm text-gray-600">No weeks match the selected filters.</p>
            ) : null}
          </div>
        </section>

        <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
          This view is read-only. It summarizes weekly reports for executive reference.
        </div>
      </div>
    </AppShell>
  );
}
