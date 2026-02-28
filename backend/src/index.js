require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { supabase } = require("./supabase");
const { authMiddleware, requireRole } = require("./middleware/auth");

const app = express();

/* ---------------------------------------------------------------------
   Config
------------------------------------------------------------------------ */
const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // allow all if not set
      return ALLOWED_ORIGINS.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS blocked"));
    },
    credentials: true,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

/* ---------------------------------------------------------------------
   Helpers (week + label)
------------------------------------------------------------------------ */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Monday-start week (school-friendly)
function getWeekRange(dateStr) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const d = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));

  // JS: Sunday=0 ... Saturday=6
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7; // Monday=>0, Sunday=>6

  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - diffToMonday);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return { week_start: isoDate(weekStart), week_end: isoDate(weekEnd) };
}

function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function avg(arr) {
  if (!arr.length) return 0;
  const s = arr.reduce((a, b) => a + (Number(b) || 0), 0);
  return s / arr.length;
}

function pickLatest(rows) {
  if (!rows?.length) return null;
  return [...rows].sort((a, b) => {
    if (a.date < b.date) return 1;
    if (a.date > b.date) return -1;
    const au = a.updated_at || "";
    const bu = b.updated_at || "";
    return bu.localeCompare(au);
  })[0];
}

/**
 * Week label format (required): 20–26 Jan 2026
 * - same month/year: 20–26 Jan 2026
 * - different month/year: 29 Jan – 04 Feb 2026
 */
function formatExecutiveWeekLabel(week_start, week_end) {
  const s = new Date(`${week_start}T00:00:00Z`);
  const e = new Date(`${week_end}T00:00:00Z`);

  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();

  const fmtDay2 = new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" });
  const fmtEndFull = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const fmtStartFull = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  if (week_start === week_end) {
    return fmtStartFull.format(s);
  }

  if (sameMonth) {
    const startDay = fmtDay2.format(s);
    const endFull = fmtEndFull.format(e); // "26 Jan 2026"
    return `${startDay}–${endFull}`;
  }

  // different months/years
  const startFull = fmtStartFull.format(s); // "29 Jan 2026"
  const endFull = fmtEndFull.format(e);     // "04 Feb 2026"
  return `${startFull} – ${endFull}`;
}

function safeError(res, context, error) {
  console.error(context, error);
  return res.status(500).json({
    error: error?.message || "Server error",
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });
}

/* ---------------------------------------------------------------------
   Auth
------------------------------------------------------------------------ */
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({
    email: req.auth.email,
    role: req.auth.role,
    is_active: req.auth.is_active,
  });
});

/* ---------------------------------------------------------------------
   Weekly reports
------------------------------------------------------------------------ */
// GET /api/weekly?week_start=YYYY-MM-DD
// If no params: returns latest by created_at
app.get("/api/weekly", authMiddleware, async (req, res) => {
  try {
    const week_start = (req.query.week_start || "").toString().trim();

    let q = supabase
      .from("weekly_reports")
      .select("id,week_start,week_end,snapshot_json,created_at");

    if (week_start) {
      q = q.eq("week_start", week_start);
    } else {
      // Load the week that CONTAINS today, not just the most recently created row.
      // This prevents a future week saved by mistake from overriding the current week.
      const today = isoDate(new Date());
      const { data: currentWeekData, error: cwErr } = await supabase
        .from("weekly_reports")
        .select("id,week_start,week_end,snapshot_json,created_at")
        .lte("week_start", today)
        .gte("week_end",   today)
        .order("week_start", { ascending: false })
        .limit(1);

      if (cwErr) return safeError(res, "weekly current-week error:", cwErr);

      // If no row spans today, fall back to the most recent past week
      if (currentWeekData && currentWeekData.length > 0) {
        const row = currentWeekData[0];
        const snapshot = row.snapshot_json || null;
        if (snapshot && row.week_start && row.week_end) {
          snapshot.weekLabel = formatExecutiveWeekLabel(row.week_start, row.week_end);
        }
        return res.json({ id: row.id, week_start: row.week_start, week_end: row.week_end, created_at: row.created_at, snapshot });
      }

      // Fallback: most recent past week
      q = q.lte("week_start", today).order("week_start", { ascending: false }).limit(1);
    }

    const { data, error } = await q;
    if (error) return safeError(res, "weekly select error:", error);

    const row = Array.isArray(data) ? data[0] : null;

    if (!row) {
      return res.json({
        id: null,
        week_start: null,
        week_end: null,
        created_at: null,
        snapshot: null,
      });
    }

    // Always guarantee the new label format
    const snapshot = row.snapshot_json || null;
    if (snapshot && row.week_start && row.week_end) {
      snapshot.weekLabel = formatExecutiveWeekLabel(row.week_start, row.week_end);
    }

    res.json({
      id: row.id,
      week_start: row.week_start,
      week_end: row.week_end,
      created_at: row.created_at,
      snapshot,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load weekly report" });
  }
});

// POST /api/weekly  (ADMIN only)
// IMPORTANT: onConflict must match your DB constraint (your table uses unique(week_start))
app.post("/api/weekly", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { week_start, week_end, snapshot } = req.body || {};
    if (!week_start || !week_end || !snapshot) {
      return res.status(400).json({ error: "week_start, week_end and snapshot are required" });
    }

    // force label format
    snapshot.weekLabel = formatExecutiveWeekLabel(week_start, week_end);

    const payload = {
      week_start,
      week_end,
      snapshot_json: snapshot,
      created_by: req.auth.userId,
    };

    const { data, error } = await supabase
      .from("weekly_reports")
      .upsert(payload, { onConflict: "week_start" })
      .select("id,week_start,week_end,created_at")
      .limit(1);

    if (error) return safeError(res, "weekly upsert error:", error);

    const row = Array.isArray(data) ? data[0] : null;
    res.json({ ok: true, row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save weekly report" });
  }
});

// GET /api/history?limit=20
app.get("/api/history", authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const { data, error } = await supabase
      .from("weekly_reports")
      .select("id,week_start,week_end,snapshot_json,created_at")
      .order("week_start", { ascending: false })
      .limit(limit);

    if (error) return safeError(res, "history select error:", error);

    // enforce label format for every item
    const items = (data || []).map((r) => {
      const snap = r.snapshot_json || null;
      if (snap && r.week_start && r.week_end) {
        snap.weekLabel = formatExecutiveWeekLabel(r.week_start, r.week_end);
      }
      return { ...r, snapshot_json: snap };
    });

    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load history" });
  }
});

/* ---------------------------------------------------------------------
   Daily updates (UPDATE + FOCUS)
------------------------------------------------------------------------ */
function normalizeKind(v) {
  const s = (v || "").toString().trim().toUpperCase();
  return s === "FOCUS" ? "FOCUS" : "UPDATE";
}

// GET /api/daily?date=YYYY-MM-DD (default today)  (returns both kinds)
app.get("/api/daily", authMiddleware, async (req, res) => {
  try {
    const date =
      (req.query.date || "").toString().trim() ||
      new Date().toISOString().slice(0, 10);

    const kind = (req.query.kind || "").toString().trim().toUpperCase(); // optional

    let q = supabase
      .from("daily_updates")
      .select("id,date,system_key,title,details,kind,created_at")
      .eq("date", date)
      .order("created_at", { ascending: false });

    if (kind === "UPDATE" || kind === "FOCUS") q = q.eq("kind", kind);

    const { data, error } = await q;
    if (error) return safeError(res, "daily select error:", error);

    res.json({ date, items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load daily updates" });
  }
});

// GET /api/daily-range?from=YYYY-MM-DD&to=YYYY-MM-DD&kind=UPDATE|FOCUS (optional)
app.get("/api/daily-range", authMiddleware, async (req, res) => {
  try {
    const from = (req.query.from || "").toString().trim();
    const to = (req.query.to || "").toString().trim();
    if (!from || !to) return res.status(400).json({ error: "from and to are required" });

    const kind = (req.query.kind || "").toString().trim().toUpperCase();

    let q = supabase
      .from("daily_updates")
      .select("id,date,system_key,title,details,kind,created_at")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    if (kind === "UPDATE" || kind === "FOCUS") q = q.eq("kind", kind);

    const { data, error } = await q;
    if (error) return safeError(res, "daily-range select error:", error);

    res.json({ from, to, items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load daily updates range" });
  }
});

// POST /api/daily (ADMIN only)  (supports kind)
app.post("/api/daily", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { date, system_key, title, details, kind } = req.body || {};
    const d =
      (date || "").toString().trim() || new Date().toISOString().slice(0, 10);

    if (!title || !details)
      return res.status(400).json({ error: "title and details are required" });

    const payload = {
      date: d,
      system_key: (system_key || "General").toString().trim(),
      title: title.toString().trim(),
      details: details.toString().trim(),
      kind: normalizeKind(kind),
      created_by: req.auth.userId,
    };

    const { data, error } = await supabase
      .from("daily_updates")
      .insert(payload)
      .select("id,date,system_key,title,details,kind,created_at")
      .limit(1);

    if (error) return safeError(res, "daily insert error:", error);

    res.json({ ok: true, item: Array.isArray(data) ? data[0] : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create daily update" });
  }
});

// DELETE /api/daily/:id (ADMIN only)
app.delete("/api/daily/:id", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const id = req.params.id;
    const { error } = await supabase.from("daily_updates").delete().eq("id", id);
    if (error) return safeError(res, "daily delete error:", error);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete daily update" });
  }
});

/* ---------------------------------------------------------------------
   Live Feed (UPDATE only — keep “Strategic Focus” separate)
------------------------------------------------------------------------ */
// GET /api/feed?limit=10
app.get("/api/feed", authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));

    const { data, error } = await supabase
      .from("daily_updates")
      .select("id,date,system_key,title,details,kind,created_at")
      .eq("kind", "UPDATE")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return safeError(res, "feed select error:", error);
    res.json({ items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load live feed" });
  }
});

/* ---------------------------------------------------------------------
   Strategic Focus (FOCUS) — backend-driven
------------------------------------------------------------------------ */
// GET /api/focus?week_start=YYYY-MM-DD  (defaults to current week)
app.get("/api/focus", authMiddleware, async (req, res) => {
  try {
    const qs = (req.query.week_start || "").toString().trim();
    const { week_start, week_end } = getWeekRange(qs || null);

    const { data, error } = await supabase
      .from("daily_updates")
      .select("id,date,system_key,title,details,kind,created_at")
      .eq("kind", "FOCUS")
      .gte("date", week_start)
      .lte("date", week_end)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) return safeError(res, "focus select error:", error);

    res.json({
      week_start,
      week_end,
      weekLabel: formatExecutiveWeekLabel(week_start, week_end),
      items: data || [],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load focus items" });
  }
});

// POST /api/focus (ADMIN) — creates a daily_updates row with kind=FOCUS
app.post("/api/focus", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { date, system_key, title, details } = req.body || {};
    const d =
      (date || "").toString().trim() || new Date().toISOString().slice(0, 10);

    if (!title || !details)
      return res.status(400).json({ error: "title and details are required" });

    const payload = {
      date: d,
      system_key: (system_key || "General").toString().trim(),
      title: title.toString().trim(),
      details: details.toString().trim(),
      kind: "FOCUS",
      created_by: req.auth.userId,
    };

    const { data, error } = await supabase
      .from("daily_updates")
      .insert(payload)
      .select("id,date,system_key,title,details,kind,created_at")
      .limit(1);

    if (error) return safeError(res, "focus insert error:", error);

    res.json({ ok: true, item: Array.isArray(data) ? data[0] : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create focus item" });
  }
});

/* ---------------------------------------------------------------------
   Metrics (Daily Metrics + Latest + Last Updated)
------------------------------------------------------------------------ */
// GET /api/metrics/latest
app.get("/api/metrics/latest", authMiddleware, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("latest_system_metrics")
      .select("system_key,metric_key,metric_value,source,meta,date,updated_at")
      .order("system_key", { ascending: true })
      .order("metric_key", { ascending: true });

    if (error) return safeError(res, "metrics/latest error:", error);
    res.json({ items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load latest metrics" });
  }
});

// GET /api/systems/last-updated
app.get("/api/systems/last-updated", authMiddleware, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("system_last_updated")
      .select("system_key,last_updated")
      .order("system_key", { ascending: true });

    if (error) return safeError(res, "systems/last-updated error:", error);
    res.json({ items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load last updated" });
  }
});

// POST /api/metrics (ADMIN only)
// body: { date, system_key, metric_key, metric_value, source?, meta? }
app.post("/api/metrics", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { date, system_key, metric_key, metric_value, source, meta } = req.body || {};

    const d = (date || "").toString().trim() || new Date().toISOString().slice(0, 10);
    const sk = (system_key || "General").toString().trim();
    const mk = (metric_key || "").toString().trim();

    if (!mk) return res.status(400).json({ error: "metric_key is required" });
    if (metric_value === undefined || metric_value === null || metric_value === "")
      return res.status(400).json({ error: "metric_value is required" });

    const payload = {
      date: d,
      system_key: sk,
      metric_key: mk,
      metric_value: Number(metric_value),
      source: (source || "Manual").toString().trim(),
      meta: meta || null,
      created_by: req.auth.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("system_metrics_daily")
      .upsert(payload, { onConflict: "date,system_key,metric_key" })
      .select("id,date,system_key,metric_key,metric_value,source,meta,updated_at")
      .limit(1);

    if (error) return safeError(res, "metrics upsert error:", error);
    res.json({ ok: true, item: Array.isArray(data) ? data[0] : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save metric" });
  }
});

/* ---------------------------------------------------------------------
   Weekly Rollup (ADMIN) - computes snapshot_json from daily metrics
------------------------------------------------------------------------ */
// POST /api/weekly/rollup
// body optional: { date: "YYYY-MM-DD" }
app.post("/api/weekly/rollup", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { date } = req.body || {};
    const { week_start, week_end } = getWeekRange(date);

    // Pull all daily metrics for that week
    const { data: rows, error: rowsErr } = await supabase
      .from("system_metrics_daily")
      .select("date,system_key,metric_key,metric_value,source,meta,updated_at")
      .gte("date", week_start)
      .lte("date", week_end);

    if (rowsErr) return safeError(res, "weekly rollup metrics select error:", rowsErr);

    const metrics = rows || [];

    // group by system_key + metric_key
    const bySystem = new Map();
    for (const r of metrics) {
      const sys = r.system_key || "General";
      const key = r.metric_key || "unknown";
      const k = `${sys}::${key}`;
      if (!bySystem.has(k)) bySystem.set(k, []);
      bySystem.get(k).push(r);
    }

    const SYSTEMS = ["MDM", "LACdrop", "Toddle Parent", "Staff Biometric Attendance"];

    function getLatestMetric(system_key, metric_key) {
      const list = bySystem.get(`${system_key}::${metric_key}`) || [];
      return pickLatest(list);
    }

    // status rules: same thresholds as the frontend pctStatus()
    // >=80 => STABLE, 70-79 => ATTENTION, <70 => CRITICAL
    function resolveStatus(systemKey) {
      let mainKey = "adoption_percent";
      if (systemKey === "MDM") mainKey = "coverage_percent";
      if (systemKey === "Staff Biometric Attendance") mainKey = "usage_percent";
      const m = getLatestMetric(systemKey, mainKey);
      const p = m ? pct(m.metric_value) : 0;
      if (p >= 80) return "STABLE";
      if (p >= 70) return "ATTENTION";
      return "CRITICAL";
    }

    function buildCategory(systemKey) {
      const isMDM = systemKey === "MDM";

      // Which metric drives the % tile
      let mainKey = "adoption_percent";
      if (isMDM) mainKey = "coverage_percent";
      if (systemKey === "Staff Biometric Attendance") mainKey = "usage_percent";
      if (systemKey === "Toddle Parent") mainKey = "progress_percent";

      const main = getLatestMetric(systemKey, mainKey);
      const focusPercent = pct(main?.metric_value ?? 0);

      const metricsBlock = {};
      const importantKeys =
        systemKey === "MDM"
          ? ["coverage_percent", "devices_enrolled", "total_devices"]
          : systemKey === "LACdrop"
            ? ["adoption_percent", "parents_active", "total_parents", "pickup_requests"]
            : systemKey === "Toddle Parent"
              ? ["adoption_percent", "parents_logged_in", "total_parents"]
              : systemKey === "Staff Biometric Attendance"
                ? ["usage_percent", "staff_captured", "total_staff", "present_percent"]
                : ["progress_percent"];

      for (const k of importantKeys) {
        const m = getLatestMetric(systemKey, k);
        if (m) metricsBlock[k] = m.metric_value;
      }

      const headline = isMDM ? "Coverage / Compliance" : "Adoption / Usage";

      return {
        id: systemKey.toLowerCase().replace(/\s+/g, "-"),
        name: systemKey,
        status: resolveStatus(systemKey),
        headline,
        focusPercent,
        metrics: metricsBlock,
      };
    }

    const categories = SYSTEMS.map(buildCategory);

    const totalSystems = categories.length;
    const operational = categories.filter((c) => c.status === "STABLE").length;
    const attention = categories.filter((c) => c.status === "ATTENTION").length;
    const critical = categories.filter((c) => c.status === "CRITICAL").length;

    const userSystems = categories.filter((c) => c.name !== "MDM");
    const avgUserAdoption = pct(avg(userSystems.map((c) => c.focusPercent)));

    const stabilityPct = pct((operational / (totalSystems || 1)) * 100);
    // Option A: Digital Health = simple average of ALL 4 systems
    const overallPercent = pct(avg(categories.map((c) => c.focusPercent)));

    // prev week overallPercent (if exists)
    const lastWeekStart = new Date(`${week_start}T00:00:00Z`);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
    const prevWeekStart = isoDate(lastWeekStart);

    const { data: prev, error: prevErr } = await supabase
      .from("weekly_reports")
      .select("snapshot_json")
      .eq("week_start", prevWeekStart)
      .limit(1);

    if (prevErr) return safeError(res, "weekly rollup prev snapshot error:", prevErr);

    const prevSnap = Array.isArray(prev) && prev[0]?.snapshot_json ? prev[0].snapshot_json : null;
    const lastWeekOverallPercent =
      typeof prevSnap?.metrics?.overallPercent === "number"
        ? pct(prevSnap.metrics.overallPercent)
        : null;

    // Alerts: latest UPDATE items in the week (not focus)
    const { data: alertsRows, error: alertsErr } = await supabase
      .from("daily_updates")
      .select("title,system_key,created_at")
      .eq("kind", "UPDATE")
      .gte("date", week_start)
      .lte("date", week_end)
      .order("created_at", { ascending: false })
      .limit(10);

    if (alertsErr) return safeError(res, "weekly rollup alerts error:", alertsErr);

    const alerts = (alertsRows || []).map((u) =>
      u.system_key ? `${u.system_key}: ${u.title}` : u.title
    );

    const weekLabel = formatExecutiveWeekLabel(week_start, week_end);

    const snapshot_json = {
      weekLabel,
      week_start,
      week_end,
      asOfDateISO: week_end,
      alerts,
      categories,
      metrics: {
        operational,
        attention,
        critical,
        avgUserAdoption,
        stabilityPct,
        overallPercent,
        lastWeekOverallPercent,
      },
    };

    const { data: up, error: upErr } = await supabase
      .from("weekly_reports")
      .upsert(
        {
          week_start,
          week_end,
          snapshot_json,
          created_by: req.auth.userId,
        },
        { onConflict: "week_start" }
      )
      .select("id,week_start,week_end,snapshot_json,created_at")
      .limit(1);

    if (upErr) return safeError(res, "weekly rollup upsert error:", upErr);

    const row = Array.isArray(up) ? up[0] : null;

    res.json({
      ok: true,
      id: row?.id || null,
      week_start,
      week_end,
      created_at: row?.created_at || null,
      snapshot: row?.snapshot_json || snapshot_json,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Weekly rollup failed" });
  }
});

/* ---------------------------------------------------------------------
   DELETE a weekly snapshot (e.g. added by mistake)
------------------------------------------------------------------------ */
app.post("/api/weekly/delete", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { week_start } = req.body || {};
    if (!week_start) return res.status(400).json({ error: "week_start is required" });

    const { error } = await supabase
      .from("weekly_reports")
      .delete()
      .eq("week_start", week_start);

    if (error) return safeError(res, "weekly delete error:", error);

    res.json({ ok: true, deleted: week_start });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Delete failed" });
  }
});

/* ---------------------------------------------------------------------
   LACdrop Sync (ADMIN only)
   POST /api/sync/lacdrop
   Calls the LACdrop external API, saves the result as a metric row
   in system_metrics_daily for system_key="LACdrop".
   A manual override saved on the same date in Updates.tsx will take
   priority on the next rollup (pickLatest uses updated_at ordering).
------------------------------------------------------------------------ */
app.post("/api/sync/lacdrop", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const lacdropUrl = process.env.LACDROP_API_URL;
    const lacdropKey = process.env.LACDROP_API_KEY;

    if (!lacdropUrl || !lacdropKey) {
      return res.status(500).json({
        error: "LACDROP_API_URL or LACDROP_API_KEY not configured on this server.",
      });
    }

    // Call LACdrop's external adoption endpoint
    const endpoint = `${lacdropUrl}/api/admin/adoption/rolling/external`;
    let lacdropData;
    try {
      const r = await fetch(endpoint, {
        headers: { Authorization: `ApiKey ${lacdropKey}` },
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(502).json({
          error: `LACdrop API returned ${r.status}: ${text.slice(0, 200)}`,
        });
      }
      const json = await r.json();
      lacdropData = json?.data ?? json; // handle { data: {...} } or flat response
    } catch (fetchErr) {
      return res.status(502).json({
        error: `Could not reach LACdrop backend: ${fetchErr?.message}`,
      });
    }

    // Extract fields — adjust keys if LACdrop returns different names
    const adoptionPct      = Number(lacdropData?.parentsUsingPct   ?? lacdropData?.adoption_percent ?? 0);
    const parentsUsedApp   = Number(lacdropData?.parentsUsedApp    ?? lacdropData?.parents_active   ?? 0);
    const totalParents     = Number(lacdropData?.totalEligibleParents ?? lacdropData?.total_parents ?? 0);
    const adminOverridePct = lacdropData?.adminOverridePct != null
      ? Number(lacdropData.adminOverridePct)
      : null;

    // If previewOnly=true, just return the fetched data without saving
    const previewOnly = req.body?.previewOnly === true;

    // Use today as the metric date
    const today = isoDate(new Date());

    if (previewOnly) {
      return res.json({
        ok: true,
        synced: { date: today, adoptionPct, parentsUsedApp, totalParents, adminOverridePct },
      });
    }

    // Build meta block so the dashboard can show "187/309" style counts
    const meta = {
      source: "LACdrop API sync",
      active: parentsUsedApp || null,
      total:  totalParents   || null,
      syncedAt: new Date().toISOString(),
      ...(adminOverridePct != null ? { adminOverridePct } : {}),
    };

    // Save adoption_percent
    const { error: upsertErr } = await supabase
      .from("system_metrics_daily")
      .upsert(
        {
          date:         today,
          system_key:   "LACdrop",
          metric_key:   "adoption_percent",
          metric_value: adoptionPct,
          source:       "API",
          meta,
          created_by:   req.auth.userId,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: "date,system_key,metric_key" }
      );

    if (upsertErr) return safeError(res, "lacdrop sync upsert error:", upsertErr);

    // Also save parents_active and total_parents if available
    if (parentsUsedApp > 0) {
      await supabase.from("system_metrics_daily").upsert(
        { date: today, system_key: "LACdrop", metric_key: "parents_active",
          metric_value: parentsUsedApp, source: "API", meta: null,
          created_by: req.auth.userId, updated_at: new Date().toISOString() },
        { onConflict: "date,system_key,metric_key" }
      );
    }
    if (totalParents > 0) {
      await supabase.from("system_metrics_daily").upsert(
        { date: today, system_key: "LACdrop", metric_key: "total_parents",
          metric_value: totalParents, source: "API", meta: null,
          created_by: req.auth.userId, updated_at: new Date().toISOString() },
        { onConflict: "date,system_key,metric_key" }
      );
    }

    res.json({
      ok: true,
      synced: {
        date:          today,
        adoptionPct,
        parentsUsedApp,
        totalParents,
        adminOverridePct,
      },
    });
  } catch (e) {
    console.error("lacdrop sync error:", e);
    res.status(500).json({ error: "LACdrop sync failed" });
  }
});

/* ---------------------------------------------------------------------
   Activity Log
   POST /api/activity        — log an action (any auth'd user)
   GET  /api/activity        — fetch log (ADMIN only)
------------------------------------------------------------------------ */

// Helper used internally by other endpoints too
async function logActivity({ userEmail, userRole, action, detail }) {
  try {
    await supabase.from("dashboard_activity_log").insert({
      user_email: userEmail,
      user_role:  userRole  || "UNKNOWN",
      action,
      detail:     detail    || null,
    });
  } catch (e) {
    console.error("logActivity failed:", e?.message);
  }
}

// POST /api/activity — called by frontend on sign-in, sign-out, page views, actions
app.post("/api/activity", authMiddleware, async (req, res) => {
  try {
    const { action, detail } = req.body ?? {};
    if (!action) return res.status(400).json({ error: "action required" });

    await logActivity({
      userEmail: req.auth.email,
      userRole:  req.auth.role,
      action:    String(action).slice(0, 100),
      detail:    detail ? String(detail).slice(0, 500) : null,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/activity error:", e);
    res.status(500).json({ error: "Failed to log activity" });
  }
});

// GET /api/activity — ADMIN only, paginated, filterable
app.get("/api/activity", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const email  = req.query.email  || null;
    const action = req.query.action || null;

    let query = supabase
      .from("dashboard_activity_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (email)  query = query.eq("user_email", email);
    if (action) query = query.eq("action", action);

    const { data, error, count } = await query;
    if (error) return safeError(res, "activity log fetch:", error);

    res.json({ logs: data, total: count });
  } catch (e) {
    console.error("GET /api/activity error:", e);
    res.status(500).json({ error: "Failed to fetch activity log" });
  }
});

/* ---------------------------------------------------------------------
   Error handler
------------------------------------------------------------------------ */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});