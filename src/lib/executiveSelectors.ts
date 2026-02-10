import type { WeeklySnapshot, HealthStatus } from "./reportStore";

export type ExecHealthTile = {
  label: string;
  value: string;
  status: HealthStatus;
};

export function getExecutiveHealth(snapshot: WeeklySnapshot): ExecHealthTile[] {
  const total = snapshot.categories.length;

  const operational = snapshot.categories.filter(c => c.status === "STABLE").length;
  const attention = snapshot.categories.filter(c => c.status === "ATTENTION").length;

  const avgAdoption =
    snapshot.categories.reduce((a, c) => a + (c.focusPercent || 0), 0) / total;

  return [
    { label: "Systems Operational", value: `${operational} / ${total}`, status: "STABLE" },
    { label: "Needs Attention", value: `${attention}`, status: attention ? "ATTENTION" : "STABLE" },
    { label: "Average Adoption", value: `${Math.round(avgAdoption)}%`, status: "STABLE" },
  ];
}
