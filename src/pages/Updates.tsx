import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import {
  getDefaultSnapshot,
  upsertCategory,
  removeCategory,
  type CategorySnapshot,
  type HealthStatus,
  type WeeklySnapshot,
} from "../lib/reportStore";

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

// ─── Constants ────────────────────────────────────────────────────────────────

const CORE_SYSTEMS = [
  "MDM",
  "LACdrop",
  "Staff Biometric Attendance",
  "Toddle Parent",
] as const;

type CoreSystem = (typeof CORE_SYSTEMS)[number];

// The metric key that drives the % ring on the dashboard for each system
const MAIN_PCT_KEY: Record<CoreSystem, string> = {
  "MDM":                          "coverage_percent",
  "LACdrop":                      "adoption_percent",
  "Staff Biometric Attendance":   "usage_percent",
  "Toddle Parent":                "adoption_percent",
};

// Human labels for active/total fields per system
const PAIR_LABELS: Record<CoreSystem, [string, string, string, string]> = {
  "MDM":                          ["Enrolled",        "Total devices",  "devices_enrolled", "total_devices"],
  "LACdrop":                      ["Parents active",  "Total parents",  "parents_active",   "total_parents"],
  "Staff Biometric Attendance":   ["Staff captured",  "Total staff",    "staff_captured",   "total_staff"],
  "Toddle Parent":                ["Parents logged in","Total parents",  "parents_logged_in","total_parents"],
};

const DEFAULT_PRESETS: Record<string, { label: string; key: string }[]> = {
  MDM: [
    { label: "Coverage %",        key: "coverage_percent"  },
    { label: "Devices enrolled",  key: "devices_enrolled"  },
    { label: "Total devices",     key: "total_devices"     },
  ],
  LACdrop: [
    { label: "Adoption %",        key: "adoption_percent"  },
    { label: "Parents active",    key: "parents_active"    },
    { label: "Total parents",     key: "total_parents"     },
    { label: "Pickup requests",   key: "pickup_requests"   },
  ],
  "Staff Biometric Attendance": [
    { label: "Usage %",           key: "usage_percent"     },
    { label: "Staff captured",    key: "staff_captured"    },
    { label: "Total staff",       key: "total_staff"       },
    { label: "Present %",         key: "present_percent"   },
  ],
  "Toddle Parent": [
    { label: "Adoption %",        key: "adoption_percent"  },
    { label: "Parents logged in", key: "parents_logged_in" },
    { label: "Total parents",     key: "total_parents"     },
    { label: "Progress %",        key: "progress_percent"  },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

function isPercent(key: string) {
  return key.trim().toLowerCase().endsWith("_percent");
}

function parseJson(s: string): { ok: true; value: any } | { ok: false; error: string } {
  const t = (s || "").trim();
  if (!t) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(t) }; }
  catch { return { ok: false, error: "Invalid JSON — leave empty or fix the format." }; }
}

function niceTime(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function makeSlug(name: string) {
  return (
    name.trim().toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40) || `sys-${Date.now()}`
  );
}

/** Returns Monday→Sunday range for any given date string (matches backend getWeekRange) */
function weekRangeFor(dateStr: string): { week_start: string; week_end: string } {
  const base = new Date(dateStr + "T12:00:00Z");
  const day = base.getUTCDay(); // 0=Sun
  const diffToMon = (day + 6) % 7;
  const mon = new Date(base);
  mon.setUTCDate(base.getUTCDate() - diffToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { week_start: fmt(mon), week_end: fmt(sun) };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function Tab({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-[#1a2e44] text-white shadow-sm"
          : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ step, title, subtitle }: {
  step?: string; title: string; subtitle?: string;
}) {
  return (
    <div className="mb-4">
      {step && (
        <span className="mb-2 inline-flex rounded-full bg-blue-50 px-3 py-0.5 text-xs font-bold text-blue-700">
          {step}
        </span>
      )}
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-gray-600">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  const { children, ...rest } = props;
  return (
    <select
      {...rest}
      className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 ${rest.className ?? ""}`}
    >
      {children}
    </select>
  );
}

function PrimaryBtn({ loading, disabled, onClick, children }: {
  loading?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="rounded-xl bg-[#1a2e44] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

function SecondaryBtn({ loading, disabled, onClick, children }: {
  loading?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

// ─── Backdate system row state ────────────────────────────────────────────────

type BdSystemState = {
  pct: string;
  active: string;
  total: string;
  status: HealthStatus;
  note: string;
};

const EMPTY_BD: Record<CoreSystem, BdSystemState> = {
  "MDM":                          { pct: "", active: "", total: "", status: "STABLE", note: "" },
  "LACdrop":                      { pct: "", active: "", total: "", status: "STABLE", note: "" },
  "Staff Biometric Attendance":   { pct: "", active: "", total: "", status: "STABLE", note: "" },
  "Toddle Parent":                { pct: "", active: "", total: "", status: "STABLE", note: "" },
};

// ─── Delete Week Card (self-contained) ───────────────────────────────────────

function DeleteWeekCard({ flash }: { flash: (msg: string, isErr?: boolean) => void }) {
  const [anchor,  setAnchor]  = useState(() => new Date().toISOString().slice(0, 10));
  const [confirm, setConfirm] = useState(false);
  const [deleting,setDeleting]= useState(false);

  const range = useMemo(() => {
    const base = new Date(anchor + "T12:00:00Z");
    const day = base.getUTCDay();
    const mon = new Date(base); mon.setUTCDate(base.getUTCDate() - (day + 6) % 7);
    const sun = new Date(mon);  sun.setUTCDate(mon.getUTCDate() + 6);
    return { ws: mon.toISOString().slice(0,10), we: sun.toISOString().slice(0,10) };
  }, [anchor]);

  async function doDelete() {
    if (!confirm) { setConfirm(true); return; }
    try {
      setDeleting(true);
      await apiFetch("/api/weekly/delete", { method: "POST", body: JSON.stringify({ week_start: range.ws }) });
      flash(`✓ Deleted snapshot for ${range.ws}. Re-enter it correctly using Option B above.`);
      setConfirm(false);
    } catch (e: any) {
      flash(e?.message || "Delete failed.", true);
    } finally { setDeleting(false); }
  }

  return (
    <Card>
      <SectionTitle
        title="Delete / Correct a past week"
        subtitle="Use this if you added a week by mistake (e.g. added March too early). Delete it, then re-enter correctly using Option B."
      />
      <div className="max-w-xs">
        <Label>Any date within the week to delete</Label>
        <input
          type="date" value={anchor}
          onChange={e => { setAnchor(e.target.value); setConfirm(false); }}
          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <p className="mt-1.5 text-xs text-gray-500">
          Will delete: <span className="font-semibold text-gray-700">{range.ws} → {range.we}</span>
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={doDelete} disabled={deleting}
          className={`rounded-xl px-5 py-2 text-sm font-semibold transition disabled:opacity-50 ${confirm ? "bg-red-600 text-white hover:bg-red-700" : "border border-red-200 text-red-600 hover:bg-red-50"}`}
        >
          {deleting ? "Deleting…" : confirm ? "⚠ Confirm — cannot be undone" : "Delete This Week"}
        </button>
        {confirm && <button onClick={() => setConfirm(false)} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>}
      </div>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type TabId = "thisweek" | "backdate" | "advanced";

export default function Updates() {
  const [tab, setTab] = useState<TabId>("thisweek");

  // ── Data ──────────────────────────────────────────────────────────────────
  const [snapshot,      setSnapshot]      = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [weekStart,     setWeekStart]     = useState(todayISO());
  const [weekEnd,       setWeekEnd]       = useState(todayISO());
  const [latestMetrics, setLatestMetrics] = useState<MetricRow[]>([]);
  const [lastUpdated,   setLastUpdated]   = useState<SystemLastUpdated[]>([]);
  const [loading,       setLoading]       = useState(true);

  // ── This-week metric entry ────────────────────────────────────────────────
  const [mDate,   setMDate]   = useState(todayISO());
  const [mSystem, setMSystem] = useState<string>("MDM");
  const [mKey,    setMKey]    = useState("coverage_percent");
  const [mValue,  setMValue]  = useState("");
  const [mSource, setMSource] = useState<"Manual" | "API" | "Excel">("Manual");
  const [mNote,   setMNote]   = useState("");
  const [mMeta,   setMMeta]   = useState("");
  const [hActive, setHActive] = useState("");
  const [hTotal,  setHTotal]  = useState("");
  const [savingM, setSavingM] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [savingW, setSavingW] = useState(false);

  // ── Custom preset management ──────────────────────────────────────────────
  const [customPresets, setCustomPresets] = useState<Record<string, { label: string; key: string }[]>>({});
  const [newParamKey,   setNewParamKey]   = useState("");
  const [newParamLabel, setNewParamLabel] = useState("");

  // ── Add / restore system state ────────────────────────────────────────────
  const [newSysName,     setNewSysName]     = useState("");
  const [newSysStatus,   setNewSysStatus]   = useState<HealthStatus>("STABLE");
  const [newSysMainKey,  setNewSysMainKey]  = useState("adoption_percent");
  const [addSysName,     setAddSysName]     = useState("");
  const [addSysStatus,   setAddSysStatus]   = useState<HealthStatus>("STABLE");

  // ── Backdate state ────────────────────────────────────────────────────────
  // Option A: trigger rollup for a past week (daily metrics already in DB)
  const [bdRollupAnchor, setBdRollupAnchor] = useState("2026-01-12");
  const [bdRollingUp,    setBdRollingUp]    = useState(false);

  // Option B: enter figures directly (no daily metrics needed)
  const [bdAnchor,  setBdAnchor]  = useState("2026-01-06");
  const [bdSystems, setBdSystems] = useState<Record<CoreSystem, BdSystemState>>(EMPTY_BD);
  const [bdAlerts,  setBdAlerts]  = useState("");
  const [bdSaving,  setBdSaving]  = useState(false);

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [err, setErr] = useState<string | null>(null);
  const [ok,  setOk]  = useState<string | null>(null);

  function flash(msg: string, isErr = false) {
    if (isErr) { setErr(msg); setOk(null); }
    else       { setOk(msg);  setErr(null); }
    setTimeout(() => { setErr(null); setOk(null); }, 7000);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const allSystems = useMemo(() => {
    const base = Object.keys(DEFAULT_PRESETS);
    const extra = snapshot.categories.map(c => c.name);
    return Array.from(new Set([...base, ...extra]));
  }, [snapshot.categories]);

  const presetsForSystem = useMemo(() => {
    const defaults = DEFAULT_PRESETS[mSystem] ?? [{ label: "Value", key: "value" }];
    return [...defaults, ...(customPresets[mSystem] ?? [])];
  }, [mSystem, customPresets]);

  const metricsForSystem = useMemo(
    () => latestMetrics.filter(m => m.system_key === mSystem),
    [latestMetrics, mSystem]
  );

  const lastUpdatedMap = useMemo(() => {
    const m = new Map<string, string>();
    lastUpdated.forEach(r => m.set(r.system_key, r.last_updated));
    return m;
  }, [lastUpdated]);

  // Week range previews for backdate options
  const bdRollupRange = useMemo(() => weekRangeFor(bdRollupAnchor), [bdRollupAnchor]);
  const bdDirectRange = useMemo(() => weekRangeFor(bdAnchor),       [bdAnchor]);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [weekly, metrics, lu] = await Promise.all([
          apiFetch<{ week_start: string; week_end: string; snapshot: WeeklySnapshot | null }>("/api/weekly"),
          apiFetch<{ items: MetricRow[] }>("/api/metrics/latest"),
          apiFetch<{ items: SystemLastUpdated[] }>("/api/systems/last-updated"),
        ]);
        if (!alive) return;
        if (weekly?.snapshot) setSnapshot(weekly.snapshot);
        if (weekly?.week_start) setWeekStart(weekly.week_start);
        if (weekly?.week_end)   setWeekEnd(weekly.week_end);
        setLatestMetrics(metrics?.items ?? []);
        setLastUpdated(lu?.items ?? []);
      } catch (e: any) {
        if (alive) flash(e?.message || "Failed to load", true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function refreshMetrics() {
    const [m, lu] = await Promise.all([
      apiFetch<{ items: MetricRow[] }>("/api/metrics/latest"),
      apiFetch<{ items: SystemLastUpdated[] }>("/api/systems/last-updated"),
    ]);
    setLatestMetrics(m?.items ?? []);
    setLastUpdated(lu?.items ?? []);
  }

  // ── Save metric ───────────────────────────────────────────────────────────
  async function saveMetric() {
    if (!mKey.trim()) return flash("Metric key is required.", true);
    const mv = Number(mValue);
    if (!Number.isFinite(mv)) return flash("Value must be a number.", true);
    const parsed = parseJson(mMeta);
    if (!parsed.ok) return flash(parsed.error, true);
    const note = mNote.trim();
    const meta = note
      ? { ...(parsed.value && typeof parsed.value === "object" ? parsed.value : {}), note }
      : parsed.value;
    try {
      setSavingM(true);
      await apiFetch("/api/metrics", {
        method: "POST",
        body: JSON.stringify({ date: mDate, system_key: mSystem, metric_key: mKey, metric_value: mv, source: mSource, meta }),
      });
      await refreshMetrics();
      flash(`✓ Saved ${mKey} for ${mSystem}.`);
      setMValue(""); setMNote(""); setMMeta(""); setHActive(""); setHTotal("");
    } catch (e: any) {
      flash(e?.message || "Failed to save metric.", true);
    } finally {
      setSavingM(false);
    }
  }

  function applyHelper() {
    const a = Number(hActive), t = Number(hTotal);
    if (!Number.isFinite(a) || !Number.isFinite(t) || t <= 0) return flash("Enter valid Active and Total numbers.", true);
    setMValue(String(clamp((a / t) * 100)));
    setMMeta(JSON.stringify({ active: a, total: t }));
  }

  // ── Weekly rollup (current) ───────────────────────────────────────────────
  async function runRollup() {
    try {
      setRolling(true);
      await apiFetch("/api/weekly/rollup", { method: "POST", body: JSON.stringify({ date: weekEnd }) });
      const res = await apiFetch<{ week_start: string; week_end: string; snapshot: WeeklySnapshot | null }>("/api/weekly");
      if (res?.snapshot)   setSnapshot(res.snapshot);
      if (res?.week_start) setWeekStart(res.week_start);
      if (res?.week_end)   setWeekEnd(res.week_end);
      flash("✓ Rollup complete. History updated.");
    } catch (e: any) {
      flash(e?.message || "Rollup failed.", true);
    } finally {
      setRolling(false);
    }
  }

  async function saveWeekly() {
    try {
      setSavingW(true);
      const next = { ...snapshot, asOfDateISO: new Date().toISOString() };
      setSnapshot(next);
      await apiFetch("/api/weekly", { method: "POST", body: JSON.stringify({ week_start: weekStart, week_end: weekEnd, snapshot: next }) });
      flash("✓ Snapshot saved.");
    } catch (e: any) {
      flash(e?.message || "Failed to save.", true);
    } finally {
      setSavingW(false);
    }
  }

  // ── Backdate Option A: rollup a past week from stored daily metrics ────────
  async function runBdRollup() {
    try {
      setBdRollingUp(true);
      const res = await apiFetch<{ ok: boolean; week_start: string; week_end: string }>(
        "/api/weekly/rollup",
        { method: "POST", body: JSON.stringify({ date: bdRollupAnchor }) }
      );
      flash(`✓ Rolled up ${res.week_start} → ${res.week_end}. Visible in History now.`);
    } catch (e: any) {
      flash(e?.message || "Rollup failed.", true);
    } finally {
      setBdRollingUp(false);
    }
  }

  // ── Backdate Option B: direct snapshot (no daily metrics needed) ──────────
  async function saveBdDirect() {
    const { week_start, week_end } = bdDirectRange;

    const categories: CategorySnapshot[] = CORE_SYSTEMS.map(sys => {
      const f = bdSystems[sys];
      const pct     = clamp(Number(f.pct)    || 0);
      const active  = Number(f.active) || null;
      const total   = Number(f.total)  || null;

      // Build the metrics block expected by History + Dashboard
      const metrics: Record<string, number> = { [MAIN_PCT_KEY[sys]]: pct };
      const [, , activeKey, totalKey] = PAIR_LABELS[sys];
      if (active !== null) metrics[activeKey] = active;
      if (total  !== null) metrics[totalKey]  = total;

      return {
        id:           makeSlug(sys),
        name:         sys,
        status:       f.status,
        focusPercent: pct,
        headline:     "",
        notes:        f.note.trim() || undefined,
        metrics,
      };
    });

    // Status auto-derived from pct thresholds (same as live dashboard)
    // For backdate we allow manual status override since no live data exists —
    // but we still use pct thresholds for the overall score
    const pctStatus = (p: number) => p >= 80 ? "STABLE" : p >= 70 ? "ATTENTION" : "CRITICAL";
    const stableCount  = categories.filter(c => pctStatus(c.focusPercent) === "STABLE").length;
    const attentionCnt = categories.filter(c => pctStatus(c.focusPercent) === "ATTENTION").length;
    const criticalCnt  = categories.filter(c => pctStatus(c.focusPercent) === "CRITICAL").length;
    const userCats     = categories.filter(c => c.name !== "MDM");
    const adoptAvg     = Math.round(userCats.reduce((s, c) => s + c.focusPercent, 0) / (userCats.length || 1));
    const stabilityPct = Math.round((stableCount / categories.length) * 100);
    // Option A: Digital Health = simple average of all 4 systems
    const overallPct   = Math.round(categories.reduce((s, c) => s + c.focusPercent, 0) / (categories.length || 1));

    const snap: WeeklySnapshot = {
      weekLabel:    "",   // backend overwrites this
      asOfDateISO:  week_end,
      categories,
      alerts: bdAlerts.split("\n").map(s => s.trim()).filter(Boolean),
      metrics: {
        operational:      stableCount,
        attention:        attentionCnt,
        critical:         criticalCnt,
        overallPercent:   overallPct,
        stabilityPct,
        avgUserAdoption:  adoptAvg,
      },
    };

    try {
      setBdSaving(true);
      await apiFetch("/api/weekly", {
        method: "POST",
        body: JSON.stringify({ week_start, week_end, snapshot: snap }),
      });
      flash(`✓ Saved snapshot for ${week_start} → ${week_end}. Check History.`);
      setBdSystems({ ...EMPTY_BD });
      setBdAlerts("");
    } catch (e: any) {
      flash(e?.message || "Failed to save snapshot.", true);
    } finally {
      setBdSaving(false);
    }
  }

  function setBdSys(sys: CoreSystem, patch: Partial<BdSystemState>) {
    setBdSystems(prev => ({ ...prev, [sys]: { ...prev[sys], ...patch } }));
  }

  function calcBdPct(sys: CoreSystem) {
    const { active, total } = bdSystems[sys];
    const a = Number(active), t = Number(total);
    if (!Number.isFinite(a) || !Number.isFinite(t) || t <= 0) return;
    setBdSys(sys, { pct: String(clamp((a / t) * 100)) });
  }

  // ── Advanced helpers ──────────────────────────────────────────────────────
  function addCustomParam() {
    if (!newParamKey.trim()) return flash("Key is required.", true);
    const key   = newParamKey.trim().toLowerCase().replace(/\s+/g, "_");
    const label = newParamLabel.trim() || key;
    if (presetsForSystem.find(p => p.key === key)) return flash(`"${key}" already exists.`, true);
    setCustomPresets(prev => ({ ...prev, [mSystem]: [...(prev[mSystem] ?? []), { label, key }] }));
    setMKey(key);
    setNewParamKey(""); setNewParamLabel("");
  }

  function removeCustomParam(key: string) {
    setCustomPresets(prev => ({ ...prev, [mSystem]: (prev[mSystem] ?? []).filter(p => p.key !== key) }));
  }

  function updateCat(id: string, patch: Partial<CategorySnapshot>) {
    const cat = snapshot.categories.find(c => c.id === id);
    if (!cat) return;
    setSnapshot(s => upsertCategory(s, { ...cat, ...patch }));
  }

  // ── Delete a past week snapshot ───────────────────────────────────────────
  // (deleteAnchor, deleteConfirm, deleting states live in previous session's edits)
  // Kept here as no-op guards if not present — the UI block below adds full delete UI

  // ── Add a BRAND NEW system that never existed ─────────────────────────────
  async function addNewSystem() {
    const name = newSysName.trim();
    if (!name) return flash("System name is required.", true);
    if (snapshot.categories.find(c => c.name === name))
      return flash(`"${name}" already exists in the snapshot.`, true);

    // 1. Add to the snapshot categories so Dashboard shows it immediately
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40) || `sys-${Date.now()}`;
    const cat: CategorySnapshot = {
      id: slug,
      name,
      status: newSysStatus,
      focusPercent: 0,
      headline: "",
    };
    const updatedSnap = { ...snapshot, categories: [...snapshot.categories, cat] };
    setSnapshot(updatedSnap);

    // 2. Save a placeholder metric so it appears in system_metrics_daily / live metrics
    try {
      await apiFetch("/api/metrics", {
        method: "POST",
        body: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          system_key: name,
          metric_key: newSysMainKey,
          metric_value: 0,
          source: "Manual",
          meta: { note: "System added — enter first figures below" },
        }),
      });
      await refreshMetrics();
    } catch {
      // non-fatal — snapshot is already updated locally
    }

    // 3. Persist snapshot to DB
    try {
      await apiFetch("/api/weekly", {
        method: "POST",
        body: JSON.stringify({ week_start: weekStart, week_end: weekEnd, snapshot: updatedSnap }),
      });
    } catch {
      // non-fatal
    }

    // 4. Pre-select the new system in the metric form
    setMSystem(name);
    setMKey(newSysMainKey);
    setNewSysName("");
    flash(`✓ "${name}" added. You'll see it on the Dashboard within 30s. Now enter its first figures below.`);
  }

  // ── Add a system BACK (previously existed, was removed from snapshot) ──────
  function addSystemBack() {
    const name = addSysName.trim();
    if (!name) return flash("Pick a system to add back.", true);
    if (snapshot.categories.find(c => c.name === name))
      return flash(`"${name}" is already in the snapshot.`, true);
    const cat: CategorySnapshot = {
      id: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      name,
      status: addSysStatus,
      focusPercent: 0,
      headline: "",
    };
    setSnapshot(s => ({ ...s, categories: [...s.categories, cat] }));
    setAddSysName("");
    flash(`✓ Added "${name}" back. Set Focus % in the list above then click Save Snapshot.`);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Updates</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter metrics for the live dashboard, run weekly rollups, and backdate past weeks.
          </p>
          {loading && <p className="mt-1 text-xs text-gray-400">Loading current data…</p>}
        </div>

        {/* Feedback */}
        {err && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        )}
        {ok && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{ok}</div>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          <Tab active={tab === "thisweek"}  onClick={() => setTab("thisweek")}>This Week</Tab>
          <Tab active={tab === "backdate"}  onClick={() => setTab("backdate")}>Backdate Past Weeks</Tab>
          <Tab active={tab === "advanced"}  onClick={() => setTab("advanced")}>Advanced</Tab>
        </div>

        {/* ══════════════════════════════════════════════════════════
            THIS WEEK
        ══════════════════════════════════════════════════════════ */}
        {tab === "thisweek" && (
          <div className="space-y-5">

            {/* Metric entry */}
            <Card>
              <SectionTitle
                step="Step 1"
                title="Enter today's figures"
                subtitle="Saves to the database. The Executive Dashboard reads these live."
              />

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={mDate} onChange={e => setMDate(e.target.value)} />
                </div>
                <div>
                  <Label>System</Label>
                  <Select
                    value={mSystem}
                    onChange={e => {
                      setMSystem(e.target.value);
                      setMKey(DEFAULT_PRESETS[e.target.value]?.[0]?.key ?? "value");
                      setHActive(""); setHTotal("");
                    }}
                  >
                    {allSystems.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <p className="mt-1 text-xs text-gray-400">
                    Last updated: {niceTime(lastUpdatedMap.get(mSystem))}
                  </p>
                </div>
                <div>
                  <Label>Metric</Label>
                  <Select value={mKey} onChange={e => setMKey(e.target.value)}>
                    {presetsForSystem.map(p => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </Select>
                  {/* Quick-select pills */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {presetsForSystem.map(p => (
                      <button
                        key={p.key}
                        onClick={() => setMKey(p.key)}
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition ${
                          mKey === p.key ? "bg-[#1a2e44] text-white border-[#1a2e44]" : "text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <Label>Value</Label>
                  <Input
                    value={mValue}
                    onChange={e => setMValue(e.target.value)}
                    placeholder="e.g. 90"
                  />
                </div>
                <div>
                  <Label>Source</Label>
                  <Select value={mSource} onChange={e => setMSource(e.target.value as any)}>
                    <option value="Manual">Manual</option>
                    <option value="API">API</option>
                    <option value="Excel">Excel</option>
                  </Select>
                </div>
                <div>
                  <Label>Note <span className="font-normal text-gray-400">(shows on dashboard)</span></Label>
                  <Input value={mNote} onChange={e => setMNote(e.target.value)} placeholder="Optional note for leadership" />
                </div>
              </div>

              {/* Active / Total helper — only for % metrics */}
              {isPercent(mKey) && (
                <div className="mt-4 rounded-xl border bg-[#F7F8FA] p-4">
                  <p className="text-xs font-semibold text-gray-700">
                    Calculate % from Active / Total
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Dashboard shows "503/523" when both are set.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <Label>Active / enrolled</Label>
                      <Input value={hActive} onChange={e => setHActive(e.target.value)} placeholder="503" />
                    </div>
                    <div>
                      <Label>Total</Label>
                      <Input value={hTotal} onChange={e => setHTotal(e.target.value)} placeholder="523" />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={applyHelper}
                        className="mt-1 w-full rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
                      >
                        Calculate &amp; fill
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Raw JSON meta — hidden by default */}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-gray-400 hover:text-gray-600">
                  Raw JSON meta (advanced)
                </summary>
                <textarea
                  value={mMeta}
                  onChange={e => setMMeta(e.target.value)}
                  className="mt-2 w-full rounded-xl border px-3 py-2 font-mono text-sm"
                  rows={2}
                  placeholder='{"active":503,"total":523}'
                />
              </details>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <PrimaryBtn loading={savingM} onClick={saveMetric}>Save Metric</PrimaryBtn>
                <SecondaryBtn onClick={refreshMetrics}>Refresh</SecondaryBtn>
              </div>

              {/* Stored metrics — click to pre-fill the form above */}
              {metricsForSystem.length > 0 && (
                <div className="mt-5">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Stored metrics — {mSystem}
                  </p>
                  <p className="mb-2 text-xs text-gray-400">Click any card to load its current value into the form above.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {metricsForSystem.map(m => (
                      <button
                        key={m.metric_key}
                        onClick={() => {
                          setMKey(m.metric_key);
                          setMValue(String(m.metric_value));
                          setMSource((m.source as any) || "Manual");
                          if (m.meta?.note) setMNote(m.meta.note);
                          if (m.meta?.active != null) setHActive(String(m.meta.active));
                          if (m.meta?.total  != null) setHTotal(String(m.meta.total));
                          const metaClone = m.meta ? { ...m.meta } : null;
                          if (metaClone?.note) delete metaClone.note;
                          setMMeta(metaClone && Object.keys(metaClone).length > 0 ? JSON.stringify(metaClone) : "");
                          flash(`Loaded "${m.metric_key}" — adjust and save.`);
                        }}
                        className={`rounded-xl border p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 active:scale-95 ${mKey === m.metric_key ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300" : "border-gray-100 bg-[#F7F8FA]"}`}
                      >
                        <p className="text-[10px] font-semibold text-gray-400">{m.metric_key}</p>
                        <p className="mt-0.5 text-xl font-black text-gray-900">{m.metric_value}</p>
                        <p className="mt-0.5 text-[10px] text-gray-400">{m.source} · {m.date}</p>
                        <p className="mt-1 text-[9px] font-semibold text-blue-400">tap to edit →</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Weekly rollup */}
            <Card>
              <SectionTitle
                step="Step 2"
                title="Run weekly rollup"
                subtitle="Do this once at end of week. Computes the snapshot from all saved metrics and adds it to History."
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Week start</Label>
                  <Input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} />
                </div>
                <div>
                  <Label>Week end</Label>
                  <Input type="date" value={weekEnd} onChange={e => setWeekEnd(e.target.value)} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <PrimaryBtn loading={rolling} onClick={runRollup}>Run Weekly Rollup</PrimaryBtn>
                <SecondaryBtn loading={savingW} onClick={saveWeekly}>Save Manual Snapshot</SecondaryBtn>
              </div>
            </Card>

            {/* Manage parameters */}
            <Card>
              <SectionTitle
                title={`Manage parameters — ${mSystem}`}
                subtitle="Add or remove metric keys tracked for this system."
              />

              {(customPresets[mSystem] ?? []).length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {(customPresets[mSystem] ?? []).map(p => (
                    <div key={p.key} className="flex items-center gap-1.5 rounded-full border bg-[#F7F8FA] pl-3 pr-1.5 py-1">
                      <span className="text-xs font-semibold text-gray-700">{p.label} ({p.key})</span>
                      <button
                        onClick={() => removeCustomParam(p.key)}
                        className="rounded-full p-0.5 text-gray-400 hover:text-red-500"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M2 2l8 8M10 2l-8 8" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label>Key (snake_case)</Label>
                  <Input value={newParamKey} onChange={e => setNewParamKey(e.target.value)} placeholder="e.g. parents_online" />
                </div>
                <div>
                  <Label>Display label</Label>
                  <Input value={newParamLabel} onChange={e => setNewParamLabel(e.target.value)} placeholder="e.g. Parents Online" />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={addCustomParam}
                    className="mt-1 w-full rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    + Add Parameter
                  </button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            BACKDATE PAST WEEKS
        ══════════════════════════════════════════════════════════ */}
        {tab === "backdate" && (
          <div className="space-y-5">

            {/* Explanation */}
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm text-blue-800">
              <p className="font-semibold mb-1">Two ways to enter past weeks into History:</p>
              <p><strong>Option A</strong> — If daily metrics are already in the database for that week, pick any date in that week and trigger the rollup. The system reads from the DB and builds the snapshot automatically.</p>
              <p className="mt-1"><strong>Option B</strong> — You have a paper/Excel report (like January) but no daily metrics were saved. Enter the final figures directly below. No daily metrics needed — it saves straight to History.</p>
            </div>

            {/* Option A */}
            <Card>
              <SectionTitle
                title="Option A — Rollup from stored metrics"
                subtitle="Use when daily metrics for that week are already in the database."
              />
              <div className="max-w-xs">
                <Label>Any date within that week</Label>
                <Input type="date" value={bdRollupAnchor} onChange={e => setBdRollupAnchor(e.target.value)} />
                <p className="mt-1.5 text-xs text-gray-500">
                  Will roll up:{" "}
                  <span className="font-semibold text-gray-700">
                    {bdRollupRange.week_start} → {bdRollupRange.week_end}
                  </span>
                </p>
              </div>
              <div className="mt-4">
                <PrimaryBtn loading={bdRollingUp} onClick={runBdRollup}>
                  Roll Up This Week
                </PrimaryBtn>
              </div>
            </Card>

            {/* Option B */}
            <Card>
              <SectionTitle
                title="Option B — Enter figures directly"
                subtitle="Use for January or any week where you have a report but no daily metrics were saved."
              />

              {/* Week anchor */}
              <div className="mb-5 max-w-xs">
                <Label>Any date within that week</Label>
                <Input type="date" value={bdAnchor} onChange={e => setBdAnchor(e.target.value)} />
                <p className="mt-1.5 text-xs text-gray-500">
                  Saving for week:{" "}
                  <span className="font-semibold text-[#1a2e44]">
                    {bdDirectRange.week_start} → {bdDirectRange.week_end}
                  </span>
                </p>
              </div>

              {/* Per-system rows */}
              <div className="space-y-3">
                {CORE_SYSTEMS.map(sys => {
                  const f = bdSystems[sys];
                  const [activeLabel, totalLabel] = PAIR_LABELS[sys];
                  const pctLabel = sys === "MDM" ? "Coverage %" : sys === "Staff Biometric Attendance" ? "Usage %" : "Adoption %";
                  const canCalc = Number(f.active) > 0 && Number(f.total) > 0;

                  return (
                    <div key={sys} className="rounded-xl border border-gray-100 bg-[#F7F8FA] p-4">
                      {/* System header */}
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-gray-800">{sys}</p>
                        <Select
                          value={f.status}
                          onChange={e => setBdSys(sys, { status: e.target.value as HealthStatus })}
                          className="!mt-0 w-auto rounded-lg border-gray-200 bg-white py-1 text-xs font-semibold"
                        >
                          <option value="STABLE">Stable</option>
                          <option value="ATTENTION">Attention</option>
                          <option value="CRITICAL">Critical</option>
                        </Select>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                        {/* Active */}
                        <div>
                          <Label>{activeLabel}</Label>
                          <Input
                            value={f.active}
                            onChange={e => setBdSys(sys, { active: e.target.value })}
                            placeholder="e.g. 503"
                            className="bg-white"
                          />
                        </div>
                        {/* Total */}
                        <div>
                          <Label>{totalLabel}</Label>
                          <Input
                            value={f.total}
                            onChange={e => setBdSys(sys, { total: e.target.value })}
                            placeholder="e.g. 523"
                            className="bg-white"
                          />
                        </div>
                        {/* % */}
                        <div>
                          <Label>{pctLabel}</Label>
                          <div className="mt-1 flex gap-1">
                            <input
                              value={f.pct}
                              onChange={e => setBdSys(sys, { pct: e.target.value })}
                              placeholder="auto"
                              className="w-full rounded-xl border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                            {canCalc && (
                              <button
                                onClick={() => calcBdPct(sys)}
                                className="flex-shrink-0 rounded-xl border bg-white px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                                title="Calculate % from active/total"
                              >
                                Calc
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Note */}
                        <div>
                          <Label>Note <span className="font-normal text-gray-400">(optional)</span></Label>
                          <Input
                            value={f.note}
                            onChange={e => setBdSys(sys, { note: e.target.value })}
                            placeholder="Brief note"
                            className="bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Alerts */}
              <div className="mt-4">
                <Label>Alerts / highlights <span className="font-normal text-gray-400">(one per line, optional)</span></Label>
                <textarea
                  value={bdAlerts}
                  onChange={e => setBdAlerts(e.target.value)}
                  rows={3}
                  placeholder={"e.g. LACdrop: Parent onboarding started\nMDM: 2 new device enrolments"}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="mt-4">
                <PrimaryBtn loading={bdSaving} onClick={saveBdDirect}>
                  Save Snapshot for {bdDirectRange.week_start} → {bdDirectRange.week_end}
                </PrimaryBtn>
              </div>
            </Card>

            {/* Delete / correct a past week */}
            <DeleteWeekCard flash={flash} />
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            ADVANCED
        ══════════════════════════════════════════════════════════ */}
        {tab === "advanced" && (
          <div className="space-y-5">

            {/* Status overrides */}
            <Card>
              <SectionTitle
                title="System status overrides"
                subtitle="Override the status and notes for the current week snapshot."
              />
              {snapshot.categories.length === 0 ? (
                <p className="text-sm text-gray-400">No categories yet. Run a rollup first.</p>
              ) : (
                <div className="space-y-3">
                  {snapshot.categories.map(c => (
                    <div key={c.id} className="rounded-xl border bg-[#F7F8FA] p-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        <div>
                          <Label>Name</Label>
                          <Input value={c.name} onChange={e => updateCat(c.id, { name: e.target.value })} className="bg-white" />
                        </div>
                        <div>
                          <Label>Status</Label>
                          <Select value={c.status} onChange={e => updateCat(c.id, { status: e.target.value as HealthStatus })} className="bg-white">
                            <option value="STABLE">Stable</option>
                            <option value="ATTENTION">Attention</option>
                            <option value="CRITICAL">Critical</option>
                          </Select>
                        </div>
                        <div>
                          <Label>Focus %</Label>
                          <Input type="number" value={c.focusPercent}
                            onChange={e => updateCat(c.id, { focusPercent: Number(e.target.value) })} className="bg-white" />
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={() => setSnapshot(s => removeCategory(s, c.id))}
                            className="mt-1 w-full rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="mt-3">
                        <Label>Notes (shown on dashboard)</Label>
                        <Input value={c.notes || ""} onChange={e => updateCat(c.id, { notes: e.target.value })}
                          placeholder="Brief note for leadership" className="bg-white" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Add New System */}
            <Card>
              <SectionTitle
                title="Add a new system"
                subtitle="Create a brand-new IT system that has never existed. It will immediately appear on the Dashboard, History, and all menus."
              />
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>System name</Label>
                  <input
                    value={newSysName}
                    onChange={e => setNewSysName(e.target.value)}
                    placeholder="e.g. Google Workspace"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div>
                  <Label>Primary metric key</Label>
                  <select
                    value={newSysMainKey}
                    onChange={e => setNewSysMainKey(e.target.value)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="adoption_percent">adoption_percent (user-facing app)</option>
                    <option value="usage_percent">usage_percent (infrastructure/staff)</option>
                    <option value="coverage_percent">coverage_percent (device/MDM-style)</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <Label>Initial status</Label>
                <div className="mt-1.5 flex gap-2">
                  {(["STABLE","ATTENTION","CRITICAL"] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setNewSysStatus(s)}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                        newSysStatus === s
                          ? s === "STABLE" ? "bg-emerald-100 text-emerald-700" : s === "ATTENTION" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                          : "border border-gray-200 text-gray-400 hover:bg-gray-50"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                <PrimaryBtn disabled={!newSysName.trim()} onClick={addNewSystem}>
                  + Add New System
                </PrimaryBtn>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                After adding, go to <strong>This Week</strong> to enter the first figures for this system.
              </p>
            </Card>

            {/* Restore a removed system */}
            <Card>
              <SectionTitle
                title="Restore a removed system"
                subtitle="If you accidentally removed one of the 4 core systems from the snapshot, add it back here."
              />
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label>System</Label>
                  <select
                    value={addSysName}
                    onChange={e => setAddSysName(e.target.value)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="">— pick —</option>
                    {(["MDM","LACdrop","Staff Biometric Attendance","Toddle Parent"] as const).filter(s => !snapshot.categories.find(c => c.name === s)).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Initial status</Label>
                  <select
                    value={addSysStatus}
                    onChange={e => setAddSysStatus(e.target.value as HealthStatus)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="STABLE">Stable</option>
                    <option value="ATTENTION">Attention</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={addSystemBack} disabled={!addSysName}
                    className="mt-1 w-full rounded-xl border border-[#1a2e44] px-4 py-2 text-sm font-semibold text-[#1a2e44] hover:bg-[#f0f4f8] disabled:opacity-40"
                  >
                    + Restore
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">After restoring, set Focus % in the Status Overrides card above, then click Save Snapshot.</p>
            </Card>

            {/* Alerts */}
            <Card>
              <SectionTitle
                title="Dashboard alerts"
                subtitle="Shown in the amber box on the Executive Dashboard. One per line."
              />
              <textarea
                value={snapshot.alerts.join("\n")}
                onChange={e => setSnapshot({
                  ...snapshot,
                  alerts: e.target.value.split("\n").map(s => s.trim()).filter(Boolean),
                })}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                rows={4}
                placeholder="One alert per line"
              />
              <div className="mt-3">
                <SecondaryBtn loading={savingW} onClick={saveWeekly}>Save Snapshot</SecondaryBtn>
              </div>
            </Card>
          </div>
        )}

      </div>
    </AppShell>
  );
}