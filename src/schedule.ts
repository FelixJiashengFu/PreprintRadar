/** When automatic recommendations are due — shared by the desktop scheduler and the web version. */

export interface ScheduleSettings {
  scheduleEnabled: boolean;
  scheduleMode: "interval" | "daily";
  intervalValue: number;
  intervalUnit: "minutes" | "hours" | "days";
  /** "HH:MM", local time, used when scheduleMode is "daily" */
  dailyTime: string;
}

export const MIN_INTERVAL_MINUTES = 15;

export function intervalMs(s: ScheduleSettings): number {
  const unit = s.intervalUnit === "minutes" ? 60_000 : s.intervalUnit === "hours" ? 3_600_000 : 86_400_000;
  return Math.max(s.intervalValue * unit, MIN_INTERVAL_MINUTES * 60_000);
}

/**
 * When the next automatic run is due (may be in the past = due now); null when switched off.
 * A failed run is retried after 30 minutes instead of waiting a whole interval.
 */
export function computeNextRun(s: ScheduleSettings, lastStart: number | null, lastFailed: boolean, now = Date.now()) {
  if (!s.scheduleEnabled) return null;
  if (lastStart === null) return 0;
  let next: number;
  if (s.scheduleMode === "daily") {
    const [h, m] = s.dailyTime.split(":").map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    const lastSlot = d.getTime() <= now ? d.getTime() : d.getTime() - 86_400_000;
    next = lastStart < lastSlot ? lastSlot : lastSlot + 86_400_000;
  } else {
    next = lastStart + intervalMs(s);
  }
  if (lastFailed) next = Math.min(next, lastStart + 30 * 60_000);
  return next;
}
