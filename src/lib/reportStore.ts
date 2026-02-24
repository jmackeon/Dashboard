// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus = "STABLE" | "ATTENTION" | "CRITICAL";

export interface CategorySnapshot {
  id: string;
  name: string;
  status: HealthStatus;
  focusPercent: number;
  headline: string;
  notes?: string;
  metrics?: Record<string, number | string>;
}

export interface WeeklySnapshot {
  weekLabel: string;
  asOfDateISO: string;
  categories: CategorySnapshot[];
  alerts: string[];
  metrics?: Record<string, number | string>;
}

// ─── Helpers used by Updates.tsx ─────────────────────────────────────────────

export function upsertCategory(
  snapshot: WeeklySnapshot,
  cat: CategorySnapshot
): WeeklySnapshot {
  const idx = snapshot.categories.findIndex((c) => c.id === cat.id);
  const categories =
    idx >= 0
      ? snapshot.categories.map((c, i) => (i === idx ? cat : c))
      : [...snapshot.categories, cat];
  return { ...snapshot, categories };
}

export function removeCategory(
  snapshot: WeeklySnapshot,
  id: string
): WeeklySnapshot {
  return {
    ...snapshot,
    categories: snapshot.categories.filter((c) => c.id !== id),
  };
}

// ─── Fallback (used before API resolves) ─────────────────────────────────────

export function getDefaultSnapshot(): WeeklySnapshot {
  return {
    weekLabel: "Loading…",
    asOfDateISO: new Date().toISOString(),
    categories: [],
    alerts: [],
  };
}
