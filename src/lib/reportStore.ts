export type HealthStatus = "STABLE" | "ATTENTION" | "CRITICAL";

export type CategoryKey = "MDM" | "LACdrop" | "Online Test" | string;

export interface CategorySnapshot {
  id: string; // stable identifier
  name: CategoryKey;
  status: HealthStatus;
  focusPercent: number; // for donut (0-100)
  headline: string; // short text shown on tile
  notes?: string; // optional longer note
  // free-form metrics so you can add more without changing code
  metrics?: Record<string, number | string>;
}

export interface WeeklySnapshot {
  weekLabel: string; // e.g., "Week 03 (20–26 Jan 2026)"
  asOfDateISO: string; // ISO date string
  categories: CategorySnapshot[];
  alerts: string[];
}

const STORAGE_KEY = "lac_dashboard_weekly_snapshot_v1";

// Keep a simple local history so you can look back without any API.
const HISTORY_KEY = "lac_dashboard_weekly_history_v1";

export type DailyUpdate = {
  id: string;
  dateISO: string; // YYYY-MM-DD (local)
  system?: string; // optional tag: e.g. MDM, LACdrop
  title: string;
  detail?: string;
};

const DAILY_KEY = "lac_dashboard_daily_updates_v1";

export function getDefaultSnapshot(): WeeklySnapshot {
  return {
    weekLabel: "Week (20–26 Jan 2026)",
    asOfDateISO: new Date().toISOString(),
    categories: [
      {
        id: "mdm",
        name: "MDM",
        status: "STABLE",
        focusPercent: 35,
        headline: "503/523 enrolled (96%)",
        metrics: {
          eligible: 523,
          enrolled: 503,
          notEnrolled: 19,
        },
        notes:
          "MDM is stable for academics. Some students try to bypass via Samsung DeX; IT monitors and reports cases for discipline.",
      },
      {
        id: "lacdrop",
        name: "LACdrop",
        status: "STABLE",
        focusPercent: 40,
        headline: "~70% parent usage",
        metrics: {
          parentUsagePercent: 70,
        },
        notes:
          "System stable. This week we assisted parents. Upgrade to track reluctant users + add Taxi/public transport tracking by Mon 26 Jan.",
      },
      {
        id: "onlinetest",
        name: "Online Test",
        status: "ATTENTION",
        focusPercent: 25,
        headline: "80% complete",
        metrics: {
          completionPercent: 80,
        },
        notes:
          "Building a clean school-controlled test (based on IDAT/Testwise standards). Target ready by Fri 23 Jan 2026.",
      },
    ],
    alerts: [
      "Monitor Samsung DeX bypass attempts and report confirmed cases.",
      "Reminder messages to parents without Samsung tablets will be sent this week.",
      "Executive dashboard target completion: Tue 27 Jan 2026.",
    ],
  };
}

export function loadWeeklySnapshot(): WeeklySnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultSnapshot();
    const parsed = JSON.parse(raw) as WeeklySnapshot;
    if (!parsed?.categories?.length) return getDefaultSnapshot();
    return parsed;
  } catch {
    return getDefaultSnapshot();
  }
}

export function saveWeeklySnapshot(snapshot: WeeklySnapshot) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

/**
 * Save a snapshot AND add it to local history (most recent first).
 * This lets PRESIDENT/Admin view past weeks without any backend.
 */
export function saveWeeklySnapshotToHistory(snapshot: WeeklySnapshot) {
  saveWeeklySnapshot(snapshot);
  const history = loadWeeklyHistory();
  const cleaned = {
    ...snapshot,
    // keep history items stable by freezing the date at save time
    asOfDateISO: snapshot.asOfDateISO || new Date().toISOString(),
  };
  const next = [cleaned, ...history.filter((h) => h.weekLabel !== cleaned.weekLabel)].slice(0, 30);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export function loadWeeklyHistory(): WeeklySnapshot[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WeeklySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function loadDailyUpdates(): DailyUpdate[] {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DailyUpdate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addDailyUpdate(input: Omit<DailyUpdate, "id">): DailyUpdate[] {
  const current = loadDailyUpdates();
  const item: DailyUpdate = { id: makeId("du"), ...input };
  const next = [item, ...current].slice(0, 400);
  localStorage.setItem(DAILY_KEY, JSON.stringify(next));
  return next;
}

export function deleteDailyUpdate(id: string): DailyUpdate[] {
  const next = loadDailyUpdates().filter((d) => d.id !== id);
  localStorage.setItem(DAILY_KEY, JSON.stringify(next));
  return next;
}

export function updateDailyUpdate(id: string, patch: Partial<DailyUpdate>): DailyUpdate[] {
  const next = loadDailyUpdates().map((d) => (d.id === id ? { ...d, ...patch } : d));
  localStorage.setItem(DAILY_KEY, JSON.stringify(next));
  return next;
}

export function upsertCategory(snapshot: WeeklySnapshot, cat: CategorySnapshot): WeeklySnapshot {
  const next = { ...snapshot };
  const idx = next.categories.findIndex((c) => c.id === cat.id);
  if (idx >= 0) {
    next.categories = next.categories.map((c, i) => (i === idx ? cat : c));
  } else {
    next.categories = [...next.categories, cat];
  }
  return next;
}

export function removeCategory(snapshot: WeeklySnapshot, id: string): WeeklySnapshot {
  return { ...snapshot, categories: snapshot.categories.filter((c) => c.id !== id) };
}
