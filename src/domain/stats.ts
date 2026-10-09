import type { Card, ReviewLog } from "./types";
import { MS_PER_DAY } from "./time";

export interface TodaySummary {
  readonly reviews: number;
  readonly minutes: number;
  readonly correctRate: number | null;
  readonly newLearned: number;
}

export const summarizeToday = (logs: readonly ReviewLog[], dayStartMs: number): TodaySummary => {
  const today = logs.filter((l) => l.time >= dayStartMs);
  const ms = today.reduce((s, l) => s + l.timeTakenMs, 0);
  const graded = today.filter((l) => l.type !== "new");
  const correct = graded.filter((l) => l.rating > 1).length;
  return {
    reviews: today.length,
    minutes: Math.round(ms / 60_000),
    correctRate: graded.length > 0 ? correct / graded.length : null,
    newLearned: today.filter((l) => l.type === "new").length
  };
};

export interface Bucket {
  readonly label: string;
  readonly value: number;
}

/** Cards due per day for the next `days` days (review queue only). */
export const forecast = (cards: readonly Card[], today: number, days: number): Bucket[] => {
  const buckets = Array.from({ length: days }, (_v, i) => ({ label: i === 0 ? "Today" : `+${i}`, value: 0 }));
  for (const c of cards) {
    if (c.queue !== "review") continue;
    const offset = Math.max(0, c.due - today);
    if (offset < days) {
      const b = buckets[offset];
      if (b) buckets[offset] = { ...b, value: b.value + 1 };
    }
  }
  return buckets;
};

/** Reviews per day over the past `days` days (oldest first). */
export const reviewHistory = (logs: readonly ReviewLog[], dayStartMs: number, days: number): Bucket[] => {
  const buckets = Array.from({ length: days }, (_v, i) => ({ label: `-${days - 1 - i}`, value: 0 }));
  for (const l of logs) {
    const offset = Math.floor((dayStartMs + MS_PER_DAY - l.time) / MS_PER_DAY);
    const idx = days - 1 - offset;
    if (idx >= 0 && idx < days) {
      const b = buckets[idx];
      if (b) buckets[idx] = { ...b, value: b.value + 1 };
    }
  }
  return buckets;
};

export interface CardCountSummary {
  readonly newCount: number;
  readonly learning: number;
  readonly young: number;
  readonly mature: number;
  readonly suspended: number;
  readonly buried: number;
  readonly total: number;
}

export const countCards = (cards: readonly Card[]): CardCountSummary => {
  const s = { newCount: 0, learning: 0, young: 0, mature: 0, suspended: 0, buried: 0, total: cards.length };
  for (const c of cards) {
    if (c.queue === "suspended") s.suspended++;
    else if (c.queue === "buried") s.buried++;
    else if (c.type === "new") s.newCount++;
    else if (c.type === "learning" || c.type === "relearning") s.learning++;
    else if (c.interval < 21) s.young++;
    else s.mature++;
  }
  return s;
};

export interface Retention {
  readonly young: number | null;
  readonly mature: number | null;
  readonly overall: number | null;
}

/** Fraction of review answers that were not "Again", split by card maturity at review time. */
export const retention = (logs: readonly ReviewLog[]): Retention => {
  const reviews = logs.filter((l) => l.type === "review");
  const rate = (list: readonly ReviewLog[]): number | null => (list.length === 0 ? null : list.filter((l) => l.rating > 1).length / list.length);
  return {
    young: rate(reviews.filter((l) => l.lastInterval < 21)),
    mature: rate(reviews.filter((l) => l.lastInterval >= 21)),
    overall: rate(reviews)
  };
};

export const easeHistogram = (cards: readonly Card[]): Bucket[] => {
  const buckets = new Map<number, number>();
  for (const c of cards) {
    if (c.type !== "review") continue;
    const pct = Math.round(c.ease / 100) * 10;
    buckets.set(pct, (buckets.get(pct) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ label: `${k}%`, value: v }));
};

/** Streak of consecutive days (ending today or yesterday) with at least one review. */
export const streak = (logs: readonly ReviewLog[], dayStartMs: number): number => {
  const days = new Set(logs.map((l) => Math.floor((l.time - dayStartMs) / MS_PER_DAY)));
  let n = 0;
  let d = days.has(0) ? 0 : -1;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
};
