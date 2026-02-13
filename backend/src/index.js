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
   Helpers for weekly rollup
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
// If no params: returns latest.
app.get("/api/weekly", authMiddleware, async (req, res) => {
  try {
    const week_start = (req.query.week_start || "").toString().trim();

    let q = supabase
      .from("weekly_reports")
      .select("id,week_start,week_end,snapshot_json,created_at");

    if (week_start) q = q.eq("week_start", week_start);
    else q = q.order("created_at", { ascending: false }).limit(1);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

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

    res.json({
      id: row.id,
      week_start: row.week_start,
      week_end: row.week_end,
      created_at: row.created_at,
      snapshot: row.snapshot_json,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load weekly report" });
  }
});

// POST /api/weekly  (ADMIN only)
// keep existing behaviour, but fix conflict key to (week_start,week_end)
app.post("/api/weekly", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { week_start, week_end, snapshot } = req.body || {};
    if (!week_start || !week_end || !snapshot) {
      return res
        .status(400)
        .json({ error: "week_start, week_end and snapshot are required" });
    }

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

    if (error) {
  console.error("weekly upsert error:", error);
  return res.status(500).json({
    error: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}


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

    if (error) {
  console.error("weekly upsert error:", error);
  return res.status(500).json({
    error: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}


    res.json({ items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load history" });
  }
});

/* ---------------------------------------------------------------------
   Daily updates
------------------------------------------------------------------------ */
// GET /api/daily?date=YYYY-MM-DD (default today)
app.get("/api/daily", authMiddleware, async (req, res) => {
  try {
    const date =
      (req.query.date || "").toString().trim() ||
      new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("daily_updates")
      .select("id,date,system_key,title,details,created_at")
      .eq("date", date)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ date, items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load daily updates" });
  }
});

// GET /api/daily-range?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get("/api/daily-range", authMiddleware, async (req, res) => {
  try {
    const from = (req.query.from || "").toString().trim();
    const to = (req.query.to || "").toString().trim();
    if (!from || !to) return res.status(400).json({ error: "from and to are required" });

    const { data, error } = await supabase
      .from("daily_updates")
      .select("id,date,system_key,title,details,created_at")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ from, to, items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load daily updates range" });
  }
});

// POST /api/daily (ADMIN only)
app.post("/api/daily", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
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
      created_by: req.auth.userId,
    };

    const { data, error } = await supabase
      .from("daily_updates")
      .insert(payload)
      .select("id,date,system_key,title,details,created_at")
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
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
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete daily update" });
  }
});

/* ---------------------------------------------------------------------
   NEW: Live Feed (latest daily_updates)
------------------------------------------------------------------------ */
// GET /api/feed?limit=10
app.get("/api/feed", authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));

    const { data, error } = await supabase
      .from("daily_updates")
      .select("id,date,system_key,title,details,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load live feed" });
  }
});

/* ---------------------------------------------------------------------
   NEW: Metrics (Daily Metrics + Latest + Last Updated)
------------------------------------------------------------------------ */
// GET /api/metrics/latest
app.get("/api/metrics/latest", authMiddleware, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("latest_system_metrics")
      .select("system_key,metric_key,metric_value,source,meta,date,updated_at")
      .order("system_key", { ascending: true })
      .order("metric_key", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
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

    if (error) return res.status(500).json({ error: error.message });
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

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, item: Array.isArray(data) ? data[0] : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save metric" });
  }
});

/* ---------------------------------------------------------------------
   NEW: Weekly Rollup (ADMIN) - computes snapshot_json from daily metrics
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

    if (rowsErr) return res.status(500).json({ error: rowsErr.message });

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

    const SYSTEMS = ["MDM", "LACdrop", "Toddle Parent", "Staff Attendance", "Online Test"];

    function getLatestMetric(system_key, metric_key) {
      const list = bySystem.get(`${system_key}::${metric_key}`) || [];
      return pickLatest(list);
    }

    // Simple status rules:
    // - health_code=3 => CRITICAL
    // - health_code=2 => ATTENTION
    // - MDM dex_attempts>0 => ATTENTION
    // else STABLE
    function resolveStatus(systemKey) {
      const hc = getLatestMetric(systemKey, "health_code");
      const code = hc ? Number(hc.metric_value) : null;

      if (code === 3) return "CRITICAL";
      if (code === 2) return "ATTENTION";

      if (systemKey === "MDM") {
        const dex = getLatestMetric("MDM", "dex_attempts");
        if (dex && Number(dex.metric_value) > 0) return "ATTENTION";
      }

      return "STABLE";
    }

    function buildCategory(systemKey) {
      const isMDM = systemKey === "MDM";

      // Which metric drives the donut %
      let mainKey = "adoption_percent";
      if (isMDM) mainKey = "coverage_percent";
      if (systemKey === "Staff Attendance") mainKey = "usage_percent";
      if (systemKey === "Online Test") mainKey = "progress_percent";

      const main = getLatestMetric(systemKey, mainKey);
      const focusPercent = pct(main?.metric_value ?? 0);

      const metricsBlock = {};
      const importantKeys =
        systemKey === "MDM"
          ? ["coverage_percent", "dex_attempts", "devices_enrolled", "total_devices"]
          : systemKey === "LACdrop"
            ? ["adoption_percent", "parents_active", "total_parents", "pickup_requests"]
            : systemKey === "Toddle Parent"
              ? ["adoption_percent", "parents_logged_in", "total_parents"]
              : systemKey === "Staff Attendance"
                ? ["usage_percent", "staff_captured", "total_staff", "present_percent"]
                : ["progress_percent"];

      for (const k of importantKeys) {
        const m = getLatestMetric(systemKey, k);
        if (m) metricsBlock[k] = m.metric_value;
      }

      let notes = "";
      if (systemKey === "MDM") notes = "DeX attempts monitored. Controls + discipline reporting active.";
      if (systemKey === "LACdrop") notes = "Daily usage tracked. Parent adoption is monitored.";
      if (systemKey === "Toddle Parent") notes = "Weekly adoption derived from activity logs.";
      if (systemKey === "Staff Attendance") notes = "Daily attendance usage tracked.";
      if (systemKey === "Online Test") notes = "Progress tracked in system overview.";

      const headline = isMDM ? "Coverage / Compliance" : "Adoption / Usage";

      return {
        id: systemKey.toLowerCase().replace(/\s+/g, "-"),
        name: systemKey,
        status: resolveStatus(systemKey),
        headline,
        focusPercent,
        notes,
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
    const overallPercent = pct(stabilityPct * 0.6 + avgUserAdoption * 0.4);

    // prev week overallPercent (if exists)
    const lastWeekStart = new Date(week_start);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
    const lastWeekEnd = new Date(week_end);
    lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() - 7);

    const prevRange = {
      week_start: isoDate(lastWeekStart),
      week_end: isoDate(lastWeekEnd),
    };

    const { data: prev, error: prevErr } = await supabase
    .from("weekly_reports")
    .select("snapshot_json")
    .eq("week_start", prevRange.week_start)
    .limit(1);


    if (prevErr) return res.status(500).json({ error: prevErr.message });

    const prevSnap = Array.isArray(prev) && prev[0]?.snapshot_json ? prev[0].snapshot_json : null;
    const lastWeekOverallPercent =
      typeof prevSnap?.metrics?.overallPercent === "number"
        ? pct(prevSnap.metrics.overallPercent)
        : null;

    // Alerts: latest 10 daily updates in the week
    const { data: alertsRows } = await supabase
      .from("daily_updates")
      .select("title,system_key,created_at")
      .gte("date", week_start)
      .lte("date", week_end)
      .order("created_at", { ascending: false })
      .limit(10);

    const alerts = (alertsRows || []).map((u) =>
      u.system_key ? `${u.system_key}: ${u.title}` : u.title
    );

    const weekLabel = `Week (${week_start} to ${week_end})`;

    const snapshot_json = {
      weekLabel,
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

    if (upErr) return res.status(500).json({ error: upErr.message });

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
   Error handler
------------------------------------------------------------------------ */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
