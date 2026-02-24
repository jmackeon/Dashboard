import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
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

// ─── System accent colours (text only — no rings, no bars) ────────────────────

const SYSTEM_COLOUR: Record<string, string> = {
  "MDM":                        "#F59E0B",
  "LACdrop":                    "#2563EB",
  "Staff Biometric Attendance": "#0D9488",
  "Toddle Parent":              "#7C3AED",
};

function systemColour(key: string): string {
  return SYSTEM_COLOUR[key] ?? "#6B7280";
}

const SYSTEM_LOGO: Record<string, string> = {
  "MDM":                        "/MDM logo.png",
  "LACdrop":                    "/LacDrop.png",
  "Staff Biometric Attendance": "/Attendance.png",
  "Toddle Parent":              "/toddle.png",
};

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
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtWeekLabel(ws?: string | null, we?: string | null): string {
  if (!ws || !we) return "";
  const s = new Date(ws), e = new Date(we);
  const same = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const day  = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit" });
  const full = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const sm   = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  return same ? `${day(s)}–${full(e)}` : `${sm(s)}–${full(e)}`;
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

function rawPair(sysKey: string, sys: Record<string, MetricRow>) {
  const meta = sys[mainKey(sysKey)]?.meta;
  if (meta && typeof meta === "object") {
    const a = meta.active ?? meta.enrolled ?? meta.present ?? null;
    const b = meta.total ?? null;
    if (a !== null && b !== null) {
      const lbl =
        sysKey === "MDM"                        ? "Enrollment" :
        sysKey === "LACdrop"                    ? "Parent Usage" :
        sysKey === "Staff Biometric Attendance" ? "Staff Usage" : "Parent Usage";
      return { a: Number(a), b: Number(b), lbl };
    }
  }
  const fb: Record<string, [string, string, string]> = {
    MDM:                          ["devices_enrolled", "total_devices",  "Enrollment"],
    LACdrop:                      ["parents_active",   "total_parents",  "Parent Usage"],
    "Staff Biometric Attendance": ["staff_captured",   "total_staff",    "Staff Usage"],
    "Toddle Parent":              ["parents_logged_in","total_parents",  "Parent Usage"],
  };
  const f = fb[sysKey];
  if (f) {
    const a = sys[f[0]]?.metric_value ?? null;
    const b = sys[f[1]]?.metric_value ?? null;
    return { a: a !== null ? Number(a) : null, b: b !== null ? Number(b) : null, lbl: f[2] };
  }
  return { a: null, b: null, lbl: "Usage" };
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  if (status === "CRITICAL")
    return <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">CRITICAL</span>;
  if (status === "ATTENTION")
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">ATTENTION</span>;
  return <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">STABLE</span>;
}

// ─── System Card — percentage as bold number, no ring, no bar ─────────────────

function SystemCard({
  sysKey, liveMap, lastUpdatedMap, snapshot,
}: {
  sysKey: string;
  liveMap: Map<string, Record<string, MetricRow>>;
  lastUpdatedMap: Map<string, string>;
  snapshot: WeeklySnapshot;
}) {
  const snapCat  = snapshot.categories.find(c => c.name === sysKey);
  const sys      = liveMap.get(sysKey) || {};
  const pct      = resolvePct(sysKey, liveMap, snapCat?.focusPercent);
  const { a, b, lbl } = rawPair(sysKey, sys);
  const colour   = systemColour(sysKey);
  const logo     = SYSTEM_LOGO[sysKey] ?? null;
  const note     = sys[mainKey(sysKey)]?.meta?.note || snapCat?.notes || null;
  const lastUp   = lastUpdatedMap.get(sysKey);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">

        {/* Left: system info */}
        <div className="min-w-0 flex-1">
          {/* Logo + name + badge */}
          <div className="flex flex-wrap items-center gap-2">
            {logo && (
              <img
                src={logo}
                alt={sysKey}
                className="h-6 w-6 rounded object-contain"
              />
            )}
            <h3 className="text-sm font-bold text-gray-900">{sysKey}</h3>
            <StatusBadge status={snapCat?.status} />
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Updated: <span className="font-medium text-gray-500">{niceTimeAgo(lastUp)}</span>
          </p>

          {a !== null && b !== null ? (
            <p className="mt-3 text-sm text-gray-500">
              {lbl}:{" "}
              <span className="font-bold text-gray-900">{a}/{b}</span>
            </p>
          ) : (
            <p className="mt-3 text-sm italic text-gray-300">No figures yet</p>
          )}

          {note && (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-gray-400">
              <span className="mt-px flex-shrink-0">📌</span>
              <span>{note}</span>
            </p>
          )}
        </div>

        {/* Right: percentage — bold number in accent colour */}
        <div className="flex-shrink-0 text-right">
          <p className="text-3xl font-black leading-none sm:text-4xl" style={{ color: colour }}>
            {pct}%
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {sysKey === "MDM" ? "Enrolled" : "Adoption"}
          </p>
        </div>

      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const [snapshot,      setSnapshot]      = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [weekStart,     setWeekStart]     = useState<string | null>(null);
  const [weekEnd,       setWeekEnd]       = useState<string | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<MetricRow[]>([]);
  const [lastUpdated,   setLastUpdated]   = useState<SystemLastUpdated[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState<string | null>(null);

  const liveMap = useMemo(() => buildLiveMap(latestMetrics), [latestMetrics]);

  const lastUpdatedMap = useMemo(() => {
    const m = new Map<string, string>();
    lastUpdated.forEach(r => m.set(r.system_key, r.last_updated));
    return m;
  }, [lastUpdated]);

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
    const interval = setInterval(() => fetchAll({ silent: true }), 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ─── Derived ────────────────────────────────────────────────────────────────

  const stableCount    = snapshot.categories.filter(c => c.status === "STABLE").length;
  const attentionCount = snapshot.categories.filter(c => c.status === "ATTENTION").length;
  const criticalCount  = snapshot.categories.filter(c => c.status === "CRITICAL").length;
  const totalSystems   = snapshot.categories.length || 1;

  const pctLAC    = resolvePct("LACdrop",                    liveMap, snapshot.categories.find(c => c.name === "LACdrop")?.focusPercent);
  const pctStaff  = resolvePct("Staff Biometric Attendance", liveMap, snapshot.categories.find(c => c.name === "Staff Biometric Attendance")?.focusPercent);
  const pctToddle = resolvePct("Toddle Parent",              liveMap, snapshot.categories.find(c => c.name === "Toddle Parent")?.focusPercent);

  const thisWeekOverall = useMemo(() => {
    const stability   = Math.round((stableCount / totalSystems) * 100);
    const adoptionAvg = Math.round((pctLAC + pctStaff + pctToddle) / 3);
    return clamp(Math.round(stability * 0.6 + adoptionAvg * 0.4));
  }, [stableCount, totalSystems, pctLAC, pctStaff, pctToddle]);

  const lastWeekOverall = useMemo(() => {
    const v = (snapshot as any)?.metrics?.lastWeekOverallPercent;
    return typeof v === "number" ? clamp(v) : Math.max(0, thisWeekOverall - 3);
  }, [snapshot, thisWeekOverall]);

  const delta     = thisWeekOverall - lastWeekOverall;
  const wkLabel   = fmtWeekLabel(weekStart, weekEnd) || snapshot.weekLabel;

  // All system keys: snapshot categories first (preserves order), then any live-only ones
  const allSystemKeys = useMemo(() => {
    const fromSnap    = snapshot.categories.map(c => c.name);
    const fromMetrics = Array.from(liveMap.keys()).filter(k => !fromSnap.includes(k));
    return [...fromSnap, ...fromMetrics];
  }, [snapshot.categories, liveMap]);

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

  // ─── Blocks ─────────────────────────────────────────────────────────────────

  const errorBanner = loadError && (
    <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
      ⚠ Using cached data — {loadError}
    </div>
  );

  const weekBadge = wkLabel && wkLabel !== "Loading…" && (
    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-500">
      {wkLabel}
    </span>
  );

  // KPI strip — 2-col mobile, 3-col sm+
  const kpiStrip = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">

      <div className="rounded-2xl border border-gray-100 bg-white p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Digital Health</p>
        <div className="mt-2 flex items-end gap-2 leading-none">
          <p className="text-3xl font-black text-gray-900">{thisWeekOverall}%</p>
          <span className={`mb-0.5 text-xs font-bold ${delta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {delta >= 0 ? "▲" : "▼"}{Math.abs(delta)}%
          </span>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-400">vs last week</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Systems Stable</p>
        <div className="mt-2 flex items-end gap-1 leading-none">
          <p className="text-3xl font-black text-gray-900">{stableCount}</p>
          <span className="mb-0.5 text-lg font-light text-gray-300">/ {totalSystems}</span>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-400">
          {attentionCount === 0 && criticalCount === 0
            ? <span className="font-semibold text-emerald-500">All clear</span>
            : <>
                {attentionCount > 0 && <span className="font-semibold text-amber-500">{attentionCount} attention </span>}
                {criticalCount  > 0 && <span className="font-semibold text-red-500">{criticalCount} critical</span>}
              </>
          }
        </p>
      </div>

      <div className="col-span-2 rounded-2xl border border-gray-100 bg-white p-4 sm:col-span-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Follow-up Items</p>
        <p className={`mt-2 text-3xl font-black leading-none ${attentionCount + criticalCount > 0 ? "text-amber-500" : "text-emerald-500"}`}>
          {attentionCount + criticalCount}
        </p>
        <p className="mt-1.5 text-[10px] text-gray-400">items needing review</p>
      </div>

    </div>
  );

  const liveMetrics = (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">Live App Metrics</h2>
        <span className="text-[10px] text-gray-300">Auto-refreshes every 30s</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {allSystemKeys.map(key => (
          <SystemCard
            key={key}
            sysKey={key}
            liveMap={liveMap}
            lastUpdatedMap={lastUpdatedMap}
            snapshot={snapshot}
          />
        ))}
      </div>
    </div>
  );

  const alertsBlock = snapshot.alerts.length > 0 && (
    <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4">
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

  const footer = (
    <p className="pb-1 text-center text-xs text-gray-300">
      IT &amp; Digital Systems — London Academy Casablanca
    </p>
  );

  const body = (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Executive Dashboard</h1>
        {weekBadge}
      </div>
      {errorBanner}
      {kpiStrip}
      {liveMetrics}
      {alertsBlock}
      {footer}
    </div>
  );

  return <AppShell>{body}</AppShell>;
}