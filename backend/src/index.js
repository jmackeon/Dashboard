require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { supabase } = require("./supabase");
const { authMiddleware, requireRole } = require("./middleware/auth");

const app = express();

// --- config ------------------------------------------------------------
const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // allow all if not set
      return ALLOWED_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error("CORS blocked"));
    },
    credentials: true,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

// --- auth --------------------------------------------------------------
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ email: req.auth.email, role: req.auth.role, is_active: req.auth.is_active });
});

// --- weekly reports ----------------------------------------------------
// GET /api/weekly?week_start=YYYY-MM-DD
// If no params: returns latest.
app.get("/api/weekly", authMiddleware, async (req, res) => {
  try {
    const week_start = (req.query.week_start || "").toString().trim();

    let q = supabase.from("weekly_reports").select("id,week_start,week_end,snapshot_json,created_at");

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
app.post("/api/weekly", authMiddleware, requireRole(["ADMIN"]), async (req, res) => {
  try {
    const { week_start, week_end, snapshot } = req.body || {};
    if (!week_start || !week_end || !snapshot) {
      return res.status(400).json({ error: "week_start, week_end and snapshot are required" });
    }

    // Upsert by week_start
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

    if (error) return res.status(500).json({ error: error.message });
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

    if (error) return res.status(500).json({ error: error.message });

    res.json({ items: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load history" });
  }
});

// --- daily updates -----------------------------------------------------
// GET /api/daily?date=YYYY-MM-DD (default today)
app.get("/api/daily", authMiddleware, async (req, res) => {
  try {
    const date = (req.query.date || "").toString().trim() || new Date().toISOString().slice(0, 10);
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
    const d = (date || "").toString().trim() || new Date().toISOString().slice(0, 10);
    if (!title || !details) return res.status(400).json({ error: "title and details are required" });

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

// --- error handler -----------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
