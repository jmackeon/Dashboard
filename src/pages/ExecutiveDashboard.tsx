import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { getDefaultSnapshot, type WeeklySnapshot } from "../lib/reportStore";
import type { HealthStatus } from "../lib/reportStore";
import { apiFetch } from "../lib/api";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function statusBadge(status: HealthStatus) {
  const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";
  if (status === "STABLE") return `${base} bg-green-100 text-green-800`;
  if (status === "ATTENTION") return `${base} bg-yellow-100 text-yellow-800`;
  return `${base} bg-red-100 text-red-800`;
}

export default function ExecutiveDashboard() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch<{ snapshot: WeeklySnapshot }>("/api/weekly");
        if (!cancelled && res?.snapshot) setSnapshot(res.snapshot);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load dashboard data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const donut = useMemo(() => {
    const labels = snapshot.categories.map((c) => c.name);
    const data = snapshot.categories.map((c) => Math.max(0, Number(c.focusPercent || 0)));
    return {
      labels,
      datasets: [{ label: "Focus", data, borderWidth: 1 }],
    };
  }, [snapshot]);

  const bar = useMemo(() => {
    // simple “volume” bar using any numeric metrics we find (first numeric metric per category)
    const labels = snapshot.categories.map((c) => c.name);
    const values = snapshot.categories.map((c) => {
      const m = c.metrics || {};
      const firstNumeric = Object.values(m).find((v) => typeof v === "number") as number | undefined;
      return typeof firstNumeric === "number" ? firstNumeric : 0;
    });
    return {
      labels,
      datasets: [{ label: "Key metric (sample)", data: values, borderWidth: 1 }],
    };
  }, [snapshot]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LAC Digital Systems Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">{snapshot.weekLabel}</p>
          {loading ? (
            <p className="mt-2 text-sm text-gray-500">Loading…</p>
          ) : error ? (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          ) : null}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">System Activity Overview</h2>
              <p className="text-sm text-gray-600">How this week’s focus is distributed</p>
            </div>
            <div className="h-[280px]">
              <Doughnut
                data={donut}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">Key Figures</h2>
              <p className="text-sm text-gray-600">A quick view of a headline metric per system</p>
            </div>
            <div className="h-[280px]">
              <Bar
                data={bar}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true } },
                }}
              />
            </div>
          </div>
        </div>

        {/* Status tiles */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.categories.map((c) => (
            <div key={c.id} className="rounded-2xl border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-600">System</div>
                  <div className="text-lg font-semibold text-gray-900">{c.name}</div>
                </div>
                <span className={statusBadge(c.status)}>{c.status}</span>
              </div>
              <div className="mt-2 text-sm text-gray-800">{c.headline}</div>
              {c.notes ? <div className="mt-2 text-sm text-gray-600">{c.notes}</div> : null}
            </div>
          ))}
        </div>

        {/* Alerts */}
        <div className="rounded-2xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Alerts & Attention</h2>
          {snapshot.alerts.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
              {snapshot.alerts.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-600">No alerts this week.</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
