import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import {
  getDefaultSnapshot,
  upsertCategory,
  removeCategory,
  type CategorySnapshot,
  type HealthStatus,
} from "../lib/reportStore";
import type { WeeklySnapshot } from "../lib/reportStore";
import { apiFetch } from "../lib/api";

function makeId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .slice(0, 40) || `cat-${Date.now()}`;
}

export default function Updates() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot>(getDefaultSnapshot());
  const [newName, setNewName] = useState("");

  // dates needed for saving snapshot to DB
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [weekEnd, setWeekEnd] = useState(() => new Date().toISOString().slice(0, 10));

  // daily updates (no API? now API)
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dailySystem, setDailySystem] = useState("General");
  const [dailyTitle, setDailyTitle] = useState("");
  const [dailyDetails, setDailyDetails] = useState("");
  const [dailyItems, setDailyItems] = useState<
    { id: string; date: string; system_key: string; title: string; details: string; created_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // latest weekly snapshot
        const res = await apiFetch<{ week_start: string; week_end: string; snapshot: WeeklySnapshot }>("/api/weekly");
        if (!cancelled && res?.snapshot) {
          setSnapshot(res.snapshot);
          if (res.week_start) setWeekStart(res.week_start);
          if (res.week_end) setWeekEnd(res.week_end);
        }

        // today's daily updates
        const daily = await apiFetch<{ date: string; items: any[] }>(`/api/daily?date=${dailyDate}`);
        if (!cancelled) setDailyItems(daily.items || []);
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

  async function refreshDaily(dateISO = dailyDate) {
    const daily = await apiFetch<{ date: string; items: any[] }>(`/api/daily?date=${dateISO}`);
    setDailyItems(daily.items || []);
  }

  const totalFocus = useMemo(
    () => snapshot.categories.reduce((sum, c) => sum + (Number(c.focusPercent) || 0), 0),
    [snapshot]
  );

  async function save() {
    try {
      setSaving(true);
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

      alert("Saved. Your dashboard is updated.");
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addDailyUpdate() {
    try {
      setError(null);
      if (!dailyTitle.trim() || !dailyDetails.trim()) {
        setError("Daily update needs a title and details.");
        return;
      }
      await apiFetch("/api/daily", {
        method: "POST",
        body: JSON.stringify({
          date: dailyDate,
          system_key: dailySystem,
          title: dailyTitle.trim(),
          details: dailyDetails.trim(),
        }),
      });
      setDailyTitle("");
      setDailyDetails("");
      await refreshDaily(dailyDate);
    } catch (e: any) {
      setError(e?.message || "Failed to add daily update");
    }
  }

  async function deleteDailyUpdate(id: string) {
    if (!confirm("Delete this daily update?")) return;
    try {
      setError(null);
      await apiFetch(`/api/daily/${id}`, { method: "DELETE" });
      await refreshDaily(dailyDate);
    } catch (e: any) {
      setError(e?.message || "Failed to delete daily update");
    }
  }

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
    // smart parse numbers, keep text otherwise
    const num = Number(value);
    metrics[key] = value.trim() === "" ? "" : Number.isFinite(num) && `${num}` === value.trim() ? num : value;
    updateCat(id, { metrics });
  }

  function addMetricKey(id: string) {
    const key = prompt("Metric name (e.g. enrolled, usagePercent, completionPercent)");
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

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Updates</h1>
          <p className="mt-1 text-sm text-gray-600">
            Edit this week’s numbers and notes here. The Dashboard updates automatically.
          </p>
        </div>

        <div className="rounded-2xl border bg-white p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="text-sm font-semibold text-gray-800">Week label</label>
              <input
                value={snapshot.weekLabel}
                onChange={(e) => setSnapshot({ ...snapshot, weekLabel: e.target.value })}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="Week (20–26 Jan 2026)"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-800">Total focus</label>
              <div className="mt-1 rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-800">
                {totalFocus}%
              </div>
              <p className="mt-1 text-xs text-gray-600">Tip: aim for ~100%</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-gray-800">Week start (YYYY-MM-DD)</label>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-800">Week end (YYYY-MM-DD)</label>
              <input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex-1">
              <label className="text-sm font-semibold text-gray-800">Add a new IT area</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="e.g., Network, Canteen System, Procurement"
              />
            </div>
            <button
              onClick={addCategory}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Add
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Updates"}
            </button>
          </div>
        </div>

        {/* Daily Updates */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Daily Updates</h2>
              <p className="mt-1 text-sm text-gray-600">Add quick notes during the week. These show on the dashboard + weekly report.</p>
            </div>
            {loading ? <span className="text-sm text-gray-500">Loading…</span> : null}
          </div>

          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-sm font-semibold text-gray-800">Date</label>
              <input
                type="date"
                value={dailyDate}
                onChange={async (e) => {
                  const d = e.target.value;
                  setDailyDate(d);
                  await refreshDaily(d);
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
                <option value="General">General</option>
                {snapshot.categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-800">Title</label>
              <input
                value={dailyTitle}
                onChange={(e) => setDailyTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="e.g., Fixed DeX loophole report"
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
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Add Daily Update
            </button>
            <button
              onClick={() => refreshDaily(dailyDate)}
              className="rounded-xl border px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {dailyItems.length ? (
              dailyItems.map((it) => (
                <div key={it.id} className="rounded-xl border bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {it.system_key}: {it.title}
                      </div>
                      <div className="mt-1 text-sm text-gray-700">{it.details}</div>
                    </div>
                    <button
                      onClick={() => deleteDailyUpdate(it.id)}
                      className="rounded-lg border px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-600">No daily updates for this date.</p>
            )}
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-4">
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
                        placeholder="Short key line (e.g., 503/523 enrolled (96%))"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-gray-800">Notes (optional)</label>
                      <input
                        value={c.notes || ""}
                        onChange={(e) => updateCat(c.id, { notes: e.target.value })}
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        placeholder="1–2 short sentences"
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

        {/* Alerts */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold text-gray-800">Alerts</div>
          <textarea
            value={snapshot.alerts.join("\n")}
            onChange={(e) => setSnapshot({ ...snapshot, alerts: e.target.value.split("\n").filter(Boolean) })}
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
            rows={4}
            placeholder="One alert per line"
          />
          <button
            onClick={save}
            className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Save Updates
          </button>
        </div>
      </div>
    </AppShell>
  );
}
