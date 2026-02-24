import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { getDefaultSnapshot, type WeeklySnapshot } from "../lib/reportStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type MetricRow = {
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

// ─── Core systems ─────────────────────────────────────────────────────────────

const SYSTEMS = [
  { key: "MDM",                        label: "MDM",                        ring: "text-amber-500"  },
  { key: "LACdrop",                    label: "LACdrop",                    ring: "text-blue-600"   },
  { key: "Staff Biometric Attendance", label: "Staff Biometric Attendance", ring: "text-teal-500"   },
  { key: "Toddle Parent",              label: "Toddle Parent",              ring: "text-cyan-500"   },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: any): number {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}

function niceTimeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtWeekLabel(ws?: string | null, we?: string | null): string {
  if (!ws || !we) return "";
  const s = new Date(ws);
  const e = new Date(we);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const day = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit" });
  const full = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const shortMonth = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  return sameMonth ? `${day(s)}–${full(e)}` : `${shortMonth(s)}–${full(e)}`;
}

function buildLiveMap(rows: MetricRow[]) {
  const m = new Map<string, Record<string, MetricRow>>();
  for (const r of rows) {
    if (!m.has(r.system_key)) m.set(r.system_key, {});
    m.get(r.system_key)![r.metric_key] = r;
  }
  return m;
}

function mainKey(sysKey: string): string {
  if (sysKey === "MDM") return "coverage_percent";
  if (sysKey === "Staff Biometric Attendance") return "usage_percent";
  return "adoption_percent";
}

function resolvePct(sysKey: string, liveMap: Map<string, Record<string, MetricRow>>, fallback = 0): number {
  const live = (liveMap.get(sysKey) || {})[mainKey(sysKey)]?.metric_value;
  return typeof live === "number" ? clamp(live) : clamp(fallback);
}

/** Extract the raw A/B pair. Priority: meta.active+total > explicit metric keys */
function rawPair(
  sysKey: string,
  sys: Record<string, MetricRow>
): { a: number | null; b: number | null; rowLabel: string } {
  const meta = sys[mainKey(sysKey)]?.meta;
  if (meta && typeof meta === "object") {
    const a = meta.active ?? meta.enrolled ?? meta.present ?? null;
    const b = meta.total ?? null;
    if (a !== null && b !== null) {
      const rowLabel =
        sysKey === "MDM"                        ? "Enrollment" :
        sysKey === "LACdrop"                    ? "Parent Usage" :
        sysKey === "Staff Biometric Attendance" ? "Staff Usage" :
                                                  "Parent Usage";
      return { a: Number(a), b: Number(b), rowLabel };
    }
  }
  // Fallback to explicit stored metric keys
  const fallbacks: Record<string, [string, string, string]> = {
    MDM:                          ["devices_enrolled",  "total_devices",  "Enrollment"],
    LACdrop:                      ["parents_active",     "total_parents",  "Parent Usage"],
    "Staff Biometric Attendance": ["staff_captured",     "total_staff",    "Staff Usage"],
    "Toddle Parent":              ["parents_logged_in",  "total_parents",  "Parent Usage"],
  };
  const fb = fallbacks[sysKey];
  if (fb) {
    const a = sys[fb[0]]?.metric_value ?? null;
    const b = sys[fb[1]]?.metric_value ?? null;
    return {
      a: a !== null ? Number(a) : null,
      b: b !== null ? Number(b) : null,
      rowLabel: fb[2],
    };
  }
  return { a: null, b: null, rowLabel: "Usage" };
}

// ─── SVG Percent Ring ─────────────────────────────────────────────────────────

function PercentRing({ value, colorClass, label }: { value: number; colorClass: string; label: string }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div className="relative h-20 w-20 flex-shrink-0 sm:h-24 sm:w-24">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} stroke="#E5E7EB" strokeWidth="8" fill="none" />
        <circle
          cx="40" cy="40" r={r}
          stroke="currentColor" className={colorClass}
          strokeWidth="8" fill="none" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none text-gray-900 sm:text-xl">{value}%</span>
        <span className="mt-0.5 text-[10px] font-semibold text-gray-400 sm:text-[11px]">{label}</span>
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  if (status === "CRITICAL")
    return <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">CRITICAL</span>;
  if (status === "ATTENTION")
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">ATTENTION</span>;
  return <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">STABLE</span>;
}

// ─── System Card ──────────────────────────────────────────────────────────────

function SystemCard({
  sysKey, label, ringClass, liveMap, lastUpdatedMap, snapshot,
}: {
  sysKey: string;
  label: string;
  ringClass: string;
  liveMap: Map<string, Record<string, MetricRow>>;
  lastUpdatedMap: Map<string, string>;
  snapshot: WeeklySnapshot;
}) {
  const snapCat = snapshot.categories.find(c => c.name === sysKey);
  const sys     = liveMap.get(sysKey) || {};
  const pct     = resolvePct(sysKey, liveMap, snapCat?.focusPercent);
  const pair    = rawPair(sysKey, sys);
  const ringLabel = sysKey === "MDM" ? "Enrolled" : "Adoption";

  // Note: meta.note takes priority over snapshot notes
  const note = sys[mainKey(sysKey)]?.meta?.note || snapCat?.notes || null;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      {/* Top row: name + badge on left, ring on right */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900 sm:text-base">{label}</h3>
            <StatusBadge status={snapCat?.status} />
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Updated: <span className="font-medium text-gray-500">{niceTimeAgo(lastUpdatedMap.get(sysKey))}</span>
          </p>

          {/* Raw pair — only shown when data exists */}
          {pair.a !== null && pair.b !== null ? (
            <p className="mt-3 text-sm font-semibold text-gray-800">
              {pair.rowLabel}:{" "}
              <span className="text-base font-bold text-gray-900">{pair.a}/{pair.b}</span>
            </p>
          ) : (
            <p className="mt-3 text-sm text-gray-300">No figures yet</p>
          )}

          {/* Note — only rendered when content exists */}
          {note && (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-gray-500 sm:text-sm">
              <span className="mt-px flex-shrink-0">📌</span>
              <span>{note}</span>
            </p>
          )}
        </div>

        <PercentRing value={pct} colorClass={ringClass} label={ringLabel} />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const { role } = useAuth();
  const isAdmin = role === "ADMIN";

  const [snapshot,       setSnapshot]       = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [weekStart,      setWeekStart]       = useState<string | null>(null);
  const [weekEnd,        setWeekEnd]         = useState<string | null>(null);
  const [latestMetrics,  setLatestMetrics]   = useState<MetricRow[]>([]);
  const [lastUpdated,    setLastUpdated]     = useState<SystemLastUpdated[]>([]);
  const [loading,        setLoading]         = useState(true);
  const [loadError,      setLoadError]       = useState<string | null>(null);

  const liveMap = useMemo(() => buildLiveMap(latestMetrics), [latestMetrics]);

  const lastUpdatedMap = useMemo(() => {
    const m = new Map<string, string>();
    lastUpdated.forEach(r => m.set(r.system_key, r.last_updated));
    return m;
  }, [lastUpdated]);

  // ── Data fetching — reused by both initial load and 30s poll ─────────────
  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const [weekly, metrics, lu] = await Promise.all([
        apiFetch<{ week_start: string; week_end: string; snapshot: WeeklySnapshot }>("/api/weekly"),
        apiFetch<{ items: MetricRow[] }>("/api/metrics/latest"),
        apiFetch<{ items: SystemLastUpdated[] }>("/api/systems/last-updated"),
      ]);
      setSnapshot(weekly?.snapshot ?? getDefaultSnapshot());
      setWeekStart(weekly?.week_start ?? null);
      setWeekEnd(weekly?.week_end ?? null);
      setLatestMetrics(metrics?.items ?? []);
      setLastUpdated(lu?.items ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    // Silent poll every 30s — no full-screen spinner between polls
    const interval = setInterval(() => fetchAll({ silent: true }), 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ─── Derived values ─────────────────────────────────────────────────────────

  const stableCount    = snapshot.categories.filter(c => c.status === "STABLE").length;
  const attentionCount = snapshot.categories.filter(c => c.status === "ATTENTION").length;
  const criticalCount  = snapshot.categories.filter(c => c.status === "CRITICAL").length;
  const totalSystems   = snapshot.categories.length || 1;

  const pctLAC    = resolvePct("LACdrop",                    liveMap, snapshot.categories.find(c => c.name === "LACdrop")?.focusPercent);
  const pctStaff  = resolvePct("Staff Biometric Attendance", liveMap, snapshot.categories.find(c => c.name === "Staff Biometric Attendance")?.focusPercent);
  const pctToddle = resolvePct("Toddle Parent",              liveMap, snapshot.categories.find(c => c.name === "Toddle Parent")?.focusPercent);

  const thisWeekOverall = useMemo(() => {
    const stability  = Math.round((stableCount / totalSystems) * 100);
    const adoptionAvg = Math.round((pctLAC + pctStaff + pctToddle) / 3);
    return clamp(Math.round(stability * 0.6 + adoptionAvg * 0.4));
  }, [stableCount, totalSystems, pctLAC, pctStaff, pctToddle]);

  const lastWeekOverall = useMemo(() => {
    const v = (snapshot as any)?.metrics?.lastWeekOverallPercent;
    return typeof v === "number" ? clamp(v) : Math.max(0, thisWeekOverall - 3);
  }, [snapshot, thisWeekOverall]);

  const delta = thisWeekOverall - lastWeekOverall;
  const weekLabel = fmtWeekLabel(weekStart, weekEnd) || snapshot.weekLabel;

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center gap-2 py-16 text-sm text-gray-400">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          Loading…
        </div>
      </AppShell>
    );
  }

  // ─── Shared blocks ──────────────────────────────────────────────────────────

  // API error — subtle, non-blocking
  const errorBanner = loadError && (
    <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
      ⚠ Using cached data — {loadError}
    </div>
  );

  // Week label shown only if we have one — no noise when empty
  const weekBadge = weekLabel && weekLabel !== "Loading…" && (
    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-500">
      {weekLabel}
    </span>
  );

  // KPI strip — 3 cards, 2-col on mobile, 3-col on sm+
  const kpiStrip = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Digital Health</p>
        <div className="mt-1.5 flex items-end justify-between gap-1">
          <p className="text-3xl font-black text-gray-900">{thisWeekOverall}%</p>
          <span className={`mb-0.5 text-xs font-bold ${delta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
          </span>
        </div>
        <p className="mt-1 text-[10px] text-gray-400">vs last week</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Systems Stable</p>
        <p className="mt-1.5 text-3xl font-black text-gray-900">
          {stableCount}
          <span className="ml-1 text-lg font-light text-gray-300">/ {totalSystems}</span>
        </p>
        <p className="mt-1 text-[10px] text-gray-400">
          <span className="font-semibold text-amber-500">{attentionCount}</span> attention
          {" · "}
          <span className="font-semibold text-red-500">{criticalCount}</span> critical
        </p>
      </div>

      <div className="col-span-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:col-span-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Follow-up Items</p>
        <p className={`mt-1.5 text-3xl font-black ${attentionCount + criticalCount > 0 ? "text-amber-500" : "text-emerald-500"}`}>
          {attentionCount + criticalCount}
        </p>
        <p className="mt-1 text-[10px] text-gray-400">items needing review</p>
      </div>
    </div>
  );

  // 4 system cards — 1-col mobile, 2-col md+
  const liveMetrics = (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">Live App Metrics</h2>
        <span className="text-[10px] text-gray-300">Auto-refreshes every 30s</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SYSTEMS.map(({ key, label, ring }) => (
          <SystemCard
            key={key}
            sysKey={key}
            label={label}
            ringClass={ring}
            liveMap={liveMap}
            lastUpdatedMap={lastUpdatedMap}
            snapshot={snapshot}
          />
        ))}
      </div>
    </div>
  );

  // Alerts — only renders when alerts exist
  const alertsBlock = snapshot.alerts.length > 0 && (
    <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 sm:px-6">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-700">
        ⚠ Items Requiring Attention
      </p>
      <ul className="space-y-1.5">
        {snapshot.alerts.map((a, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
            <span className="mt-0.5 flex-shrink-0">•</span>
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  // ─── PRESIDENT VIEW ──────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="space-y-5">
          {/* Compact header — week badge only, no clutter */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Executive Dashboard</h1>
            {weekBadge}
          </div>

          {errorBanner}
          {kpiStrip}
          {liveMetrics}
          {alertsBlock}

          <p className="pb-1 text-center text-xs text-gray-300">
            IT &amp; Digital Systems — London Academy Casablanca
          </p>
        </div>
      </AppShell>
    );
  }

  // ─── ADMIN VIEW ──────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Executive Dashboard</h1>
          {weekBadge}
        </div>

        {errorBanner}
        {kpiStrip}
        {liveMetrics}
        {alertsBlock}

        <p className="pb-1 text-center text-xs text-gray-300">
          IT &amp; Digital Systems — London Academy Casablanca
        </p>
      </div>
    </AppShell>
  );
}