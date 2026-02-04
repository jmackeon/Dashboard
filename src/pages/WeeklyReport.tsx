import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { getDefaultSnapshot, type WeeklySnapshot } from "../lib/reportStore";
import { apiFetch } from "../lib/api";

function formatStatus(s: string) {
  if (s === "STABLE") return "🟢 Stable";
  if (s === "ATTENTION") return "🟡 Attention";
  return "🔴 Critical";
}

export default function WeeklyReport() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [weekEnd, setWeekEnd] = useState<string | null>(null);
  const [dailyItems, setDailyItems] = useState<
    { id: string; date: string; system_key: string; title: string; details: string; created_at: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const w = await apiFetch<{ week_start: string; week_end: string; snapshot: WeeklySnapshot }>("/api/weekly");
        if (!cancelled && w?.snapshot) {
          setSnapshot(w.snapshot);
          setWeekStart(w.week_start || null);
          setWeekEnd(w.week_end || null);
        }

        if (w?.week_start && w?.week_end) {
          const d = await apiFetch<{ items: any[] }>(`/api/daily-range?from=${w.week_start}&to=${w.week_end}`);
          if (!cancelled) setDailyItems(d.items || []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load weekly report data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reportText = useMemo(() => {
    const lines: string[] = [];
    lines.push("London Academy Casablanca");
    lines.push("Weekly Digital Systems Report");
    lines.push("");
    lines.push(`Prepared by: James Arthur Mackeon`);
    lines.push(`Reporting period: ${snapshot.weekLabel}`);
    if (weekStart && weekEnd) lines.push(`Week dates: ${weekStart} to ${weekEnd}`);
    lines.push("");

    // Executive summary: simple, auto-generated
    const stable = snapshot.categories.filter((c) => c.status === "STABLE").length;
    const attention = snapshot.categories.filter((c) => c.status === "ATTENTION").length;
    const critical = snapshot.categories.filter((c) => c.status === "CRITICAL").length;
    lines.push("Executive Summary");
    lines.push(
      `This week: ${stable} stable, ${attention} need attention, ${critical} critical. Core digital systems supported school operations.`
    );
    lines.push("");

    snapshot.categories.forEach((c, idx) => {
      lines.push(`${idx + 1}. ${c.name}`);
      lines.push(`Status: ${formatStatus(c.status)}`);
      if (c.headline) lines.push(c.headline);
      if (c.notes) lines.push(c.notes);
      lines.push("");
    });

    if (dailyItems.length) {
      lines.push("Daily Updates");
      // group by date
      const byDate = new Map<string, typeof dailyItems>();
      for (const it of dailyItems) {
        const arr = byDate.get(it.date) || [];
        arr.push(it);
        byDate.set(it.date, arr);
      }
      for (const [date, items] of Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        lines.push(`${date}`);
        for (const it of items) {
          lines.push(`- [${it.system_key}] ${it.title}: ${it.details}`);
        }
        lines.push("");
      }
    }

    if (snapshot.alerts.length) {
      lines.push("Alerts & Attention");
      snapshot.alerts.forEach((a) => lines.push(`- ${a}`));
      lines.push("");
    }

    lines.push("Prepared by:");
    lines.push("James Arthur Mackeon");
    lines.push("IT & Digital Systems");
    return lines.join("\n");
  }, [snapshot, weekStart, weekEnd, dailyItems]);


  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(reportText);
      alert("Copied. Paste into MS Word.");
    } catch {
      alert("Could not copy automatically. Please select the text and copy manually.");
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Report</h1>
          <p className="mt-1 text-sm text-gray-600">
            This page generates a simple report from your Updates. Copy and paste into MS Word.
          </p>
        </div>

        {error ? <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        <div className="flex items-center gap-2">
          <button
            onClick={copyToClipboard}
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Copy Report
          </button>
          <div className="text-sm text-gray-600">Tip: Update numbers in the Updates tab first.</div>
        </div>

        <pre className="whitespace-pre-wrap rounded-2xl border bg-white p-4 text-sm text-gray-800">
          {reportText}
        </pre>
      </div>
    </AppShell>
  );
}
