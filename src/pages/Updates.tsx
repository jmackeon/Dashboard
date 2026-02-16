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

type UpdateKind = "UPDATE" | "FOCUS";

type DailyUpdateRow = {
  id: string;
  date: string;
  system_key: string;
  title: string;
  details: string;
  kind?: UpdateKind; // NEW (backward-compatible)
  created_at: string;
};

type MetricRow = {
  system_key: string;
  metric_key: string;
  metric_value: number;
  source: string;
  meta: any;
  date: string;
  updated_at: string;
};

type SystemUpdatedRow = {
  system_key: string;
  last_updated: string;
};

type FocusWeekResponse = {
  week_start: string;
  week_end: string;
  weekLabel: string;
  items: DailyUpdateRow[];
};

function makeId(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .slice(0, 40) || `cat-${Date.now()}`
  );
}

// Common metric presets (so you don’t guess keys)
const METRIC_PRESETS: Record<string, { label: string; key: string }[]> = {
  LACdrop: [
    { label: "Adoption %", key: "adoption_percent" },
    { label: "Pickup requests (today)", key: "pickup_requests" },
    { label: "Parents active", key: "parents_active" },
    { label: "Total parents", key: "total_parents" },
  ],
  "Toddle Parent": [
    { label: "Adoption %", key: "adoption_percent" },
    { label: "Parents logged in", key: "parents_logged_in" },
    { label: "Total parents", key: "total_parents" },
  ],
  "Staff Attendance": [
    { label: "Usage %", key: "usage_percent" },
    { label: "Present %", key: "present_percent" },
    { label: "Staff captured", key: "staff_captured" },
    { label: "Total staff", key: "total_staff" },
  ],
  MDM: [
    { label: "Coverage %", key: "coverage_percent" },
    { label: "DeX attempts (today)", key: "dex_attempts" },
    { label: "Devices enrolled", key: "devices_enrolled" },
    { label: "Total devices", key: "total_devices" },
  ],
  "Online Test": [{ label: "Progress %", key: "progress_percent" }],
};

export default function Updates() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [newName, setNewName] = useState("");

  // weekly date range
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [weekEnd, setWeekEnd] = useState(() => new Date().toISOString().slice(0, 10));

  // daily updates
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dailySystem, setDailySystem] = useState("General");
  const [dailyTitle, setDailyTitle] = useState("");
  const [dailyDetails, setDailyDetails] = useState("");
  const [dailyItems, setDailyItems] = useState<DailyUpdateRow[]>([]);

  // NEW: choose whether this entry is UPDATE or FOCUS
  const [dailyKind, setDailyKind] = useState<UpdateKind>("UPDATE");
  const [dailyViewKind, setDailyViewKind] = useState<UpdateKind>("UPDATE");

  // weekly focus preview (NEW)
  const [weeklyFocus, setWeeklyFocus] = useState<FocusWeekResponse | null>(null);
  const [loadingFocus, setLoadingFocus] = useState(false);

  // daily metrics entry
  const [metricDate, setMetricDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [metricSystem, setMetricSystem] = useState("LACdrop");
  const [metricKey, setMetricKey] = useState("adoption_percent");
  const [metricValue, setMetricValue] = useState<string>("0");
  const [metricSource, setMetricSource] = useState<"Manual" | "Excel" | "ToddleLog" | "API">("Manual");
  const [metricMeta, setMetricMeta] = useState<string>(""); // optional JSON

  // latest metrics + last updated
  const [latestMetrics, setLatestMetrics] = useState<MetricRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<SystemUpdatedRow[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [savingWeekly, setSavingWeekly] = useState(false);
  const [rollingUp, setRollingUp] = useState(false);
  const [savingDaily, setSavingDaily] = useState(false);
  const [savingMetric, setSavingMetric] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ----------------------------
     Load: weekly + daily + metrics + focus
  ---------------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // latest weekly snapshot
        const res = await apiFetch<{
          week_start: string;
          week_end: string;
          snapshot: WeeklySnapshot | null;
        }>("/api/weekly");

        if (!cancelled && res?.snapshot) {
          setSnapshot(res.snapshot);
          if (res.week_start) setWeekStart(res.week_start);
          if (res.week_end) setWeekEnd(res.week_end);
        }

        // daily updates for initial date (default view kind)
        const daily = await apiFetch<{ date: string; items: DailyUpdateRow[] }>(
          `/api/daily?date=${dailyDate}&kind=${dailyViewKind}`
        );
        if (!cancelled) setDailyItems(daily.items || []);

        // latest metrics
        const m = await apiFetch<{ items: MetricRow[] }>("/api/metrics/latest");
        if (!cancelled) setLatestMetrics(m.items || []);

        // last updated per system
        const u = await apiFetch<{ items: SystemUpdatedRow[] }>("/api/systems/last-updated");
        if (!cancelled) setLastUpdated(u.items || []);

        // focus preview (current week)
        const focus = await apiFetch<FocusWeekResponse>(`/api/focus?week_start=${weekStart}`);
        if (!cancelled) setWeeklyFocus(focus || null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshDaily(dateISO = dailyDate, kind: UpdateKind = dailyViewKind) {
    const daily = await apiFetch<{ date: string; items: DailyUpdateRow[] }>(
      `/api/daily?date=${dateISO}&kind=${kind}`
    );
    setDailyItems(daily.items || []);
  }

  async function refreshMetrics() {
    const m = await apiFetch<{ items: MetricRow[] }>("/api/metrics/latest");
    setLatestMetrics(m.items || []);

    const u = await apiFetch<{ items: SystemUpdatedRow[] }>("/api/systems/last-updated");
    setLastUpdated(u.items || []);
  }

  async function refreshWeeklyFocus(anchorWeekStart = weekStart) {
    try {
      setLoadingFocus(true);
      const focus = await apiFetch<FocusWeekResponse>(`/api/focus?week_start=${anchorWeekStart}`);
      setWeeklyFocus(focus || null);
    } finally {
      setLoadingFocus(false);
    }
  }

  /* ----------------------------
     Derived UI helpers
  ---------------------------- */
  const totalFocus = useMemo(
    () => snapshot.categories.reduce((sum, c) => sum + (Number(c.focusPercent) || 0), 0),
    [snapshot]
  );

  const systemsList = useMemo(() => {
    const base = snapshot.categories.map((c) => c.name);
    const core = ["LACdrop", "Toddle Parent", "Staff Attendance", "MDM", "Online Test"];
    const set = new Set<string>(["General", ...core, ...base]);
    return Array.from(set);
  }, [snapshot.categories]);

  const lastUpdatedMap = useMemo(() => {
    const m = new Map<string, string>();
    (lastUpdated || []).forEach((x) => m.set(x.system_key, x.last_updated));
    return m;
  }, [lastUpdated]);

  const metricsForSystem = useMemo(() => {
    return latestMetrics.filter((x) => x.system_key === metricSystem);
  }, [latestMetrics, metricSystem]);

  /* ----------------------------
     Weekly Snapshot Save (optional)
  ---------------------------- */
  async function saveWeeklySnapshotManual() {
    try {
      setSavingWeekly(true);
      setError(null);
      const next: WeeklySnapshot = { ...snapshot, asOfDateISO: new Date().toISOString() };
      setSnapshot(next);

      await apiFetch("/api/weekly", {
        method: "POST",
        body: JSON.stringify({
          week_start: weekStart,
          week_end: weekEnd,
          snapshot: next,
        }),
      });

      alert("Saved weekly snapshot (manual).");
    } catch (e: any) {
      setError(e?.message || "Failed to save weekly snapshot");
    } finally {
      setSavingWeekly(false);
    }
  }

  /* ----------------------------
     Weekly Rollup
  ---------------------------- */
  async function runWeeklyRollup() {
    try {
      setRollingUp(true);
      setError(null);

      await apiFetch("/api/weekly/rollup", {
        method: "POST",
        body: JSON.stringify({ date: weekEnd }),
      });

      const res = await apiFetch<{
        week_start: string;
        week_end: string;
        snapshot: WeeklySnapshot | null;
      }>("/api/weekly");

      if (res?.snapshot) setSnapshot(res.snapshot);
      if (res.week_start) setWeekStart(res.week_start);
      if (res.week_end) setWeekEnd(res.week_end);

      // refresh focus preview too
      await refreshWeeklyFocus(res.week_start || weekStart);

      alert("Weekly rollup completed. Dashboard is updated.");
    } catch (e: any) {
      setError(e?.message || "Weekly rollup failed");
    } finally {
      setRollingUp(false);
    }
  }

  /* ----------------------------
     Daily Updates + Focus (NEW)
  ---------------------------- */
  async function addDailyUpdate() {
    try {
      setSavingDaily(true);
      setError(null);

      if (!dailyTitle.trim() || !dailyDetails.trim()) {
        setError("Entry needs a title and details.");
        return;
      }

      await apiFetch("/api/daily", {
        method: "POST",
        body: JSON.stringify({
          date: dailyDate,
          system_key: dailySystem,
          title: dailyTitle.trim(),
          details: dailyDetails.trim(),
          kind: dailyKind, // ✅ KEY CHANGE
        }),
      });

      setDailyTitle("");
      setDailyDetails("");

      // refresh the list you're currently viewing
      await refreshDaily(dailyDate, dailyViewKind);

      // if you just added a focus item, refresh focus preview
      if (dailyKind === "FOCUS") {
        await refreshWeeklyFocus(weekStart);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to add entry");
    } finally {
      setSavingDaily(false);
    }
  }

  async function deleteDailyUpdate(id: string) {
    if (!confirm("Delete this entry?")) return;
    try {
      setError(null);
      await apiFetch(`/api/daily/${id}`, { method: "DELETE" });
      await refreshDaily(dailyDate, dailyViewKind);
      await refreshWeeklyFocus(weekStart);
    } catch (e: any) {
      setError(e?.message || "Failed to delete entry");
    }
  }

  /* ----------------------------
     Daily Metrics
  ---------------------------- */
  function presetKeysFor(systemKey: string) {
    return METRIC_PRESETS[systemKey] || [{ label: "Value", key: "value" }];
  }

  function applyPresetKey(systemKey: string, key: string) {
    setMetricSystem(systemKey);
    setMetricKey(key);
  }

  async function addDailyMetric() {
    try {
      setSavingMetric(true);
      setError(null);

      const mv = Number(metricValue);
      if (!metricKey.trim()) {
        setError("Metric key is required.");
        return;
      }
      if (!Number.isFinite(mv)) {
        setError("Metric value must be a number.");
        return;
      }

      let meta: any = null;
      const metaStr = metricMeta.trim();
      if (metaStr) {
        try {
          meta = JSON.parse(metaStr);
        } catch {
          setError("Meta must be valid JSON (or leave it empty).");
          return;
        }
      }

      await apiFetch("/api/metrics", {
        method: "POST",
        body: JSON.stringify({
          date: metricDate,
          system_key: metricSystem,
          metric_key: metricKey.trim(),
          metric_value: mv,
          source: metricSource,
          meta,
        }),
      });

      await refreshMetrics();
      alert("Metric saved.");
    } catch (e: any) {
      setError(e?.message || "Failed to save metric");
    } finally {
      setSavingMetric(false);
    }
  }

  /* ----------------------------
     Category editor (kept)
  ---------------------------- */
  function addCategory() {
    if (!newName.trim()) return;
    const cat: CategorySnapshot = {
      id: makeId(newName),
      name: newName.trim(),
      status: "STABLE",
      focusPercent: 0,
      headline: "",
      notes: "",
      metrics: {},
    };
    setSnapshot((s) => upsertCategory(s, cat));
    setNewName("");
  }

  function updateCat(id: string, patch: Partial<CategorySnapshot>) {
    const current = snapshot.categories.find((c) => c.id === id);
    if (!current) return;
    setSnapshot((s) => upsertCategory(s, { ...current, ...patch }));
  }

  function updateMetric(id: string, key: string, value: string) {
    const current = snapshot.categories.find((c) => c.id === id);
    if (!current) return;
    const metrics = { ...(current.metrics || {}) };
    const num = Number(value);
    metrics[key] = value.trim() === "" ? "" : Number.isFinite(num) && `${num}` === value.trim() ? num : value;
    updateCat(id, { metrics });
  }

  function addMetricKey(id: string) {
    const key = prompt("Metric name (e.g. enrolled, usage_percent, adoption_percent)");
    if (!key) return;
    updateMetric(id, key.trim(), "0");
  }

  function removeMetricKey(id: string, key: string) {
    const current = snapshot.categories.find((c) => c.id === id);
    if (!current) return;
    const metrics = { ...(current.metrics || {}) };
    delete metrics[key];
    updateCat(id, { metrics });
  }

  // ✅ Your existing drop-in layout is preserved.
  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Updates</h1>
            <p className="mt-1 text-sm text-gray-600">
              Daily inputs → Weekly rollup → Executive dashboard updates automatically.
            </p>
          </div>
          {loading ? <span className="text-sm text-gray-500">Loading…</span> : null}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {/* =========================
            STEP 1 — DAILY INPUTS
        ========================== */}
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
                Step 1
                <span className="opacity-60">—</span>
                Daily Inputs
              </div>
              <h2 className="mt-2 text-lg font-semibold text-gray-900">Enter daily numbers + notes</h2>
              <p className="mt-1 text-sm text-gray-600">
                This is what you’ll do most often. It powers the live feed and weekly summaries.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={refreshMetrics}
                className="rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Refresh Metrics
              </button>
              <button
                onClick={() => refreshDaily(dailyDate, dailyViewKind)}
                className="rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Refresh Daily Notes
              </button>
              <button
                onClick={() => refreshWeeklyFocus(weekStart)}
                className="rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                {loadingFocus ? "Refreshing Focus…" : "Refresh Focus"}
              </button>
            </div>
          </div>

          {/* Weekly focus preview (NEW) */}
          <div className="mt-5 rounded-2xl border bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">Strategic Focus (this week)</h3>
                <p className="mt-1 text-sm text-gray-600">
                  These come from the backend via <span className="font-semibold">daily_updates.kind = FOCUS</span>.
                </p>
              </div>
              <div className="text-xs font-semibold text-gray-600">
                {weeklyFocus?.weekLabel || "—"}
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {weeklyFocus?.items?.length ? (
                weeklyFocus.items.map((it) => (
                  <div key={it.id} className="rounded-xl border bg-gray-50 p-3">
                    <div className="text-sm font-semibold text-gray-900">{it.system_key}: {it.title}</div>
                    <div className="mt-1 text-sm text-gray-700">{it.details}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {it.date} • {new Date(it.created_at).toLocaleString()}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-600">No focus items yet for this week.</p>
              )}
            </div>
          </div>

          {/* Daily Metrics Entry */}
          <div className="mt-5 rounded-2xl border bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">Daily Metrics Entry</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Add measurable values (Manual / Excel / Logs / API). Weekly rollup will compute the snapshot.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div>
                <label className="text-sm font-semibold text-gray-800">Date</label>
                <input
                  type="date"
                  value={metricDate}
                  onChange={(e) => setMetricDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-800">System</label>
                <select
                  value={metricSystem}
                  onChange={(e) => {
                    const sys = e.target.value;
                    setMetricSystem(sys);
                    const first = presetKeysFor(sys)[0]?.key || "value";
                    setMetricKey(first);
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  {systemsList
                    .filter((x) => x !== "General")
                    .map((sys) => (
                      <option key={sys} value={sys}>
                        {sys}
                      </option>
                    ))}
                </select>

                <div className="mt-1 text-xs text-gray-500">
                  Last updated:{" "}
                  <span className="font-semibold">
                    {lastUpdatedMap.get(metricSystem)
                      ? new Date(lastUpdatedMap.get(metricSystem)!).toLocaleString()
                      : "—"}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-800">Metric</label>
                <select
                  value={metricKey}
                  onChange={(e) => setMetricKey(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  {presetKeysFor(metricSystem).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} ({p.key})
                    </option>
                  ))}
                </select>

                <div className="mt-2 flex flex-wrap gap-2">
                  {presetKeysFor(metricSystem)
                    .slice(0, 3)
                    .map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => applyPresetKey(metricSystem, p.key)}
                        className="rounded-full border px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-white"
                      >
                        {p.label}
                      </button>
                    ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-800">Value</label>
                <input
                  value={metricValue}
                  onChange={(e) => setMetricValue(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="e.g. 72"
                />

                <div className="mt-2">
                  <label className="text-xs font-semibold text-gray-700">Source</label>
                  <select
                    value={metricSource}
                    onChange={(e) => setMetricSource(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  >
                    <option value="Manual">Manual</option>
                    <option value="Excel">Excel</option>
                    <option value="ToddleLog">ToddleLog</option>
                    <option value="API">API</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-sm font-semibold text-gray-800">
                Meta (optional JSON) — e.g. {"{ \"active\": 356, \"total\": 495 }"}
              </label>
              <textarea
                value={metricMeta}
                onChange={(e) => setMetricMeta(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                rows={2}
                placeholder='{"active":356,"total":495}'
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={addDailyMetric}
                disabled={savingMetric}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {savingMetric ? "Saving…" : "Save Metric"}
              </button>
            </div>

            {/* Latest metrics preview */}
            <div className="mt-4">
              <div className="text-sm font-semibold text-gray-800">Latest metrics for {metricSystem}</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {metricsForSystem.length ? (
                  metricsForSystem.map((m) => (
                    <div key={`${m.system_key}-${m.metric_key}`} className="rounded-xl border bg-white p-3">
                      <div className="text-xs font-semibold text-gray-600">{m.metric_key}</div>
                      <div className="mt-1 text-lg font-bold text-gray-900">{m.metric_value}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {m.source} • {m.date} • {new Date(m.updated_at).toLocaleString()}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-600">No metrics yet for this system.</p>
                )}
              </div>
            </div>
          </div>

          {/* Daily Updates (Notes / Feed) */}
          <div className="mt-5 rounded-2xl border bg-gray-50 p-4">
            <h3 className="font-semibold text-gray-900">Daily Entries</h3>
            <p className="mt-1 text-sm text-gray-600">
              Add either <span className="font-semibold">UPDATE</span> (live feed) or{" "}
              <span className="font-semibold">FOCUS</span> (Strategic Focus on dashboard).
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div>
                <label className="text-sm font-semibold text-gray-800">Date</label>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={async (e) => {
                    const d = e.target.value;
                    setDailyDate(d);
                    await refreshDaily(d, dailyViewKind);
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-800">System</label>
                <select
                  value={dailySystem}
                  onChange={(e) => setDailySystem(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  {systemsList.map((sys) => (
                    <option key={sys} value={sys}>
                      {sys}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-800">Type</label>
                <select
                  value={dailyKind}
                  onChange={(e) => setDailyKind(e.target.value as UpdateKind)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  <option value="UPDATE">UPDATE (Live Feed)</option>
                  <option value="FOCUS">FOCUS (Strategic Focus)</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-800">Title</label>
                <input
                  value={dailyTitle}
                  onChange={(e) => setDailyTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="e.g., DeX bypass attempts reported"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-sm font-semibold text-gray-800">Details</label>
              <textarea
                value={dailyDetails}
                onChange={(e) => setDailyDetails(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                rows={3}
                placeholder="1–3 short sentences. Keep it simple."
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={addDailyUpdate}
                disabled={savingDaily}
                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {savingDaily ? "Adding…" : "Add Entry"}
              </button>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-600">Viewing:</span>
                <select
                  value={dailyViewKind}
                  onChange={async (e) => {
                    const k = e.target.value as UpdateKind;
                    setDailyViewKind(k);
                    await refreshDaily(dailyDate, k);
                  }}
                  className="rounded-xl border px-3 py-2 text-sm"
                >
                  <option value="UPDATE">UPDATE</option>
                  <option value="FOCUS">FOCUS</option>
                </select>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {dailyItems.length ? (
                dailyItems.map((it) => (
                  <div key={it.id} className="rounded-xl border bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          {it.system_key}: {it.title}
                          <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-semibold text-gray-600">
                            {(it.kind || "UPDATE").toUpperCase()}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-gray-700">{it.details}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {it.date} • {new Date(it.created_at).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteDailyUpdate(it.id)}
                        className="rounded-lg border px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-600">No entries for this date/type.</p>
              )}
            </div>
          </div>
        </div>

        {/* =========================
            STEP 2 — WEEKLY ROLLUP
        ========================== */}
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                Step 2
                <span className="opacity-60">—</span>
                Weekly Rollup
              </div>
              <h2 className="mt-2 text-lg font-semibold text-gray-900">Generate weekly summary</h2>
              <p className="mt-1 text-sm text-gray-600">
                Run once at the end of the week. This computes the dashboard snapshot from daily metrics.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={runWeeklyRollup}
                disabled={rollingUp}
                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {rollingUp ? "Rolling up…" : "Run Weekly Rollup"}
              </button>

              <button
                onClick={saveWeeklySnapshotManual}
                disabled={savingWeekly}
                className="rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                title="Optional: save weekly snapshot manually (only if needed)"
              >
                {savingWeekly ? "Saving…" : "Save Weekly Snapshot (Manual)"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="text-sm font-semibold text-gray-800">Week label</label>
              <input
                value={snapshot.weekLabel}
                onChange={(e) => setSnapshot({ ...snapshot, weekLabel: e.target.value })}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="20–26 Jan 2026"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-800">Total focus</label>
              <div className="mt-1 rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-800">{totalFocus}%</div>
              <p className="mt-1 text-xs text-gray-600">Tip: aim for ~100%</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-gray-800">Week start</label>
              <input
                type="date"
                value={weekStart}
                onChange={async (e) => {
                  const ws = e.target.value;
                  setWeekStart(ws);
                  await refreshWeeklyFocus(ws);
                }}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-800">Week end</label>
              <input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* =========================
            STEP 3 — ADVANCED (OPTIONAL)
        ========================== */}
        <details className="rounded-2xl border bg-white p-5">
          <summary className="cursor-pointer list-none">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                  Step 3
                  <span className="opacity-60">—</span>
                  Advanced (Optional)
                </div>
                <h2 className="mt-2 text-lg font-semibold text-gray-900">Manual override tools</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Use only if you need to add new IT areas or manually adjust snapshot text.
                </p>
              </div>
              <div className="text-sm font-semibold text-gray-600">Click to expand</div>
            </div>
          </summary>

          <div className="mt-5 rounded-2xl border bg-gray-50 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Weekly Snapshot Editor (Optional)</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Keep notes/status tidy. Percentages should come from daily metrics + rollup.
                </p>
              </div>

              <button
                onClick={addCategory}
                className="rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
              >
                Add IT Area
              </button>
            </div>

            <div className="mt-3">
              <label className="text-sm font-semibold text-gray-800">New area name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="e.g., Network, Canteen System, Procurement"
              />
            </div>

            <div className="mt-4 space-y-4">
              {snapshot.categories.map((c) => (
                <div key={c.id} className="rounded-2xl border bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex-1">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <label className="text-sm font-semibold text-gray-800">Name</label>
                          <input
                            value={c.name}
                            onChange={(e) => updateCat(c.id, { name: e.target.value })}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-semibold text-gray-800">Status</label>
                          <select
                            value={c.status}
                            onChange={(e) => updateCat(c.id, { status: e.target.value as HealthStatus })}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          >
                            <option value="STABLE">Stable</option>
                            <option value="ATTENTION">Attention</option>
                            <option value="CRITICAL">Critical</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-sm font-semibold text-gray-800">Focus %</label>
                          <input
                            type="number"
                            value={c.focusPercent}
                            onChange={(e) => updateCat(c.id, { focusPercent: Number(e.target.value) })}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="text-sm font-semibold text-gray-800">Headline</label>
                          <input
                            value={c.headline}
                            onChange={(e) => updateCat(c.id, { headline: e.target.value })}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-semibold text-gray-800">Notes</label>
                          <input
                            value={c.notes || ""}
                            onChange={(e) => updateCat(c.id, { notes: e.target.value })}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-gray-800">Metrics (optional)</div>
                          <button
                            onClick={() => addMetricKey(c.id)}
                            className="text-sm font-semibold text-blue-700 hover:underline"
                            type="button"
                          >
                            + Add metric
                          </button>
                        </div>

                        {c.metrics && Object.keys(c.metrics).length ? (
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {Object.entries(c.metrics).map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2">
                                <div className="w-32 truncate text-xs font-semibold text-gray-700">{k}</div>
                                <input
                                  value={String(v ?? "")}
                                  onChange={(e) => updateMetric(c.id, k, e.target.value)}
                                  className="flex-1 rounded-xl border px-3 py-2 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeMetricKey(c.id, k)}
                                  className="rounded-lg border px-2 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                  title="Remove metric"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-gray-600">No metrics added.</p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSnapshot((s) => removeCategory(s, c.id))}
                      className="rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                      title="Remove this area"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-800">Alerts (optional)</div>
            <textarea
              value={snapshot.alerts.join("\n")}
              onChange={(e) =>
                setSnapshot({
                  ...snapshot,
                  alerts: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              rows={4}
              placeholder="One alert per line"
            />
            <button
              onClick={saveWeeklySnapshotManual}
              className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Save Weekly Snapshot (Manual)
            </button>
          </div>
        </details>
      </div>
    </AppShell>
  );
}
