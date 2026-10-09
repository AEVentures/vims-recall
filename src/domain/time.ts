export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

/**
 * Day index for scheduling: number of local calendar days since the Unix epoch,
 * shifted so that a new "day" begins at `rolloverHour` (default 4am) rather than midnight.
 */
export const dayIndex = (now: number, rolloverHour: number): number => {
  const shifted = new Date(now - rolloverHour * 3_600_000);
  return Math.floor(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()) / MS_PER_DAY);
};

/** Epoch ms at which the given day index ends (i.e. the next rollover). */
export const dayEnd = (now: number, rolloverHour: number): number => {
  const shifted = new Date(now - rolloverHour * 3_600_000);
  const nextLocalMidnight = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() + 1).getTime();
  return nextLocalMidnight + rolloverHour * 3_600_000;
};

/** Epoch ms at which the given day index began. */
export const dayStart = (now: number, rolloverHour: number): number => dayEnd(now, rolloverHour) - MS_PER_DAY;

export const formatInterval = (days: number): string => {
  if (days < 1) {
    const minutes = Math.max(1, Math.round(days * 24 * 60));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, "")}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
};

export const formatMinutes = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return formatInterval(minutes / (24 * 60));
};
