import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import type { WeeklySnapshot } from "../lib/reportStore";

type HistoryItem = {
  id: string;
  week: string;
  summary: string;
  status: "STABLE" | "ATTENTION" | "CRITICAL";
  week_start?: string;
  week_end?: string;
  created_at?: string;
};

function statusBadge(status: HistoryItem["status"]) {
  const base =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold";

  if (status === "STABLE") return `${base} bg-green-100 text-green-800`;
  if (status === "ATTENTION") return `${base} bg-yellow-100 text-yellow-800`;
  return `${base} bg-red-100 text-red-800`;
}

export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch<{ items: any[] }>("/api/history?limit=30");
        if (cancelled) return;

        const mapped: HistoryItem[] = (res.items || []).map((r) => {
          const s: WeeklySnapshot | undefined = r.snapshot_json;
          const cats = s?.categories || [];
          const hasCritical = cats.some((c: any) => c.status === "CRITICAL");
          const hasAttention = cats.some((c: any) => c.status === "ATTENTION");
          const status: HistoryItem["status"] = hasCritical ? "CRITICAL" : hasAttention ? "ATTENTION" : "STABLE";
          const summary =
            (cats
              .slice(0, 3)
              .map((c: any) => `${c.name}: ${c.headline || c.status}`)
              .join(" | ")) || "(no details)";

          return {
            id: r.id,
            week: s?.weekLabel || `${r.week_start}–${r.week_end}`,
            summary,
            status,
            week_start: r.week_start,
            week_end: r.week_end,
            created_at: r.created_at,
          };
        });

        setItems(mapped);
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

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            History
          </h1>
          <p className="text-sm text-gray-600">
            Reference view of past weekly digital systems updates
          </p>
        </div>

        {/* History list */}
        <div className="space-y-4">
          {loading ? <div className="text-sm text-gray-500">Loading…</div> : null}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border bg-white p-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {item.week}
                  </div>
                  {item.week_start && item.week_end ? (
                    <div className="mt-1 text-xs text-gray-500">
                      {item.week_start} to {item.week_end}
                    </div>
                  ) : null}
                  <div className="mt-1 text-sm text-gray-700">
                    {item.summary}
                  </div>
                </div>

                <span className={statusBadge(item.status)}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Note */}
        <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
          This section is read-only and intended for reference purposes.
        </div>
      </div>
    </AppShell>
  );
}
