const { supabase } = require("../supabase");

function bearerToken(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * Verifies the Supabase access token and loads the user's role from public."User".
 * Attaches:
 *   req.auth = { userId, email, role, is_active }
 */
async function authMiddleware(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    // Validate token
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const user = userData.user;

    // Load role from your public."User" table
    const { data: rows, error: roleErr } = await supabase
      .from("User")
      .select("role,is_active,email,auth_uid")
      .eq("auth_uid", user.id)
      .limit(1);

    if (roleErr) {
      return res.status(500).json({ error: `Role lookup failed: ${roleErr.message}` });
    }

    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.role || row?.is_active !== true) {
      return res.status(403).json({ error: "Account not active or role missing" });
    }

    req.auth = {
      userId: user.id,
      email: row.email || user.email || null,
      role: row.role,
      is_active: row.is_active,
    };

    next();
  } catch (e) {
    console.error("authMiddleware error", e);
    res.status(500).json({ error: "Auth middleware failed" });
  }
}

function requireRole(roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    const role = req.auth?.role;
    if (!role || !allowed.has(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
