// src/lib/week.ts
export function formatExecutiveWeekLabel(week_start: string, week_end: string) {
  const s = new Date(week_start);
  const e = new Date(week_end);

  if (week_start === week_end) {
    return s.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();

  if (sameMonth) {
    const startDay = s.toLocaleDateString(undefined, { day: "2-digit" });
    const endFull = e.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return `${startDay}–${endFull}`;
  }

  const startFull = s.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const endFull = e.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return `${startFull}–${endFull}`;
}
