import type { Card, DeckOptions, IntervalPreview, Rating } from "./types";
import { MS_PER_MINUTE, formatInterval, formatMinutes } from "./time";

export interface SchedulerContext {
  /** epoch ms */
  readonly now: number;
  /** today's day index (see time.dayIndex) */
  readonly today: number;
  /** random source in [0,1); inject a constant for deterministic previews/tests */
  readonly random: () => number;
}

export interface AnswerResult {
  readonly card: Card;
  /** true when the card crossed the leech threshold on this answer */
  readonly becameLeech: boolean;
  /** scheduled interval for the review log: days for review cards, minutes for intraday steps (negative) */
  readonly loggedInterval: number;
}

const MIN_EASE = 1300;

/* ---------- interval fuzz (mirrors Anki's ranges) ---------- */

const fuzzRange = (interval: number): readonly [number, number] => {
  if (interval < 2) return [1, 1];
  if (interval === 2) return [2, 3];
  const fuzz = interval < 7 ? Math.max(1, Math.round(interval * 0.25)) : interval < 30 ? Math.max(2, Math.round(interval * 0.15)) : Math.max(4, Math.round(interval * 0.05));
  return [interval - fuzz, interval + fuzz];
};

export const fuzzInterval = (interval: number, random: () => number): number => {
  const [lo, hi] = fuzzRange(interval);
  return lo + Math.floor(random() * (hi - lo + 1));
};

const constrain = (interval: number, opts: DeckOptions): number => Math.min(opts.maxInterval, Math.max(1, Math.round(interval)));

/* ---------- learning steps ---------- */

const stepDelayMinutes = (steps: readonly number[], left: number): number => {
  const idx = Math.max(0, steps.length - left);
  return steps[Math.min(idx, steps.length - 1)] ?? 1;
};

const hardDelayMinutes = (steps: readonly number[], left: number): number => {
  if (steps.length === 1) return (steps[0] ?? 1) * 1.5;
  const idx = Math.max(0, steps.length - left);
  const current = steps[idx] ?? steps[steps.length - 1] ?? 1;
  const next = steps[idx + 1] ?? current * 2;
  return idx === 0 ? (current + next) / 2 : current;
};

/* ---------- review intervals ---------- */

export interface ReviewIntervals {
  readonly hard: number;
  readonly good: number;
  readonly easy: number;
}

export const reviewIntervals = (card: Card, opts: DeckOptions, today: number): ReviewIntervals => {
  const delay = card.queue === "review" ? Math.max(0, today - card.due) : 0;
  const ease = card.ease / 1000;
  const mod = opts.intervalModifier;
  const hard = constrain(Math.max(card.interval + 1, card.interval * opts.hardInterval * mod), opts);
  const good = constrain(Math.max(hard + 1, (card.interval + delay / 2) * ease * mod), opts);
  const easy = constrain(Math.max(good + 1, (card.interval + delay) * ease * opts.easyBonus * mod), opts);
  return { hard, good, easy };
};

const lapseInterval = (card: Card, opts: DeckOptions): number => constrain(Math.max(opts.minLapseInterval, card.interval * opts.newInterval), opts);

/* ---------- transitions ---------- */

const graduate = (card: Card, interval: number, opts: DeckOptions, ctx: SchedulerContext, fuzz: boolean): Card => {
  const ivl = fuzz ? fuzzInterval(constrain(interval, opts), ctx.random) : constrain(interval, opts);
  return {
    ...card,
    type: "review",
    queue: "review",
    interval: ivl,
    ease: card.type === "new" || card.type === "learning" ? opts.startingEase : card.ease,
    due: ctx.today + ivl,
    left: 0
  };
};

const enterLearning = (card: Card, steps: readonly number[], left: number, delayMinutes: number, ctx: SchedulerContext, type: Card["type"]): Card => ({
  ...card,
  type,
  queue: "learn",
  left: Math.min(left, steps.length),
  due: ctx.now + delayMinutes * MS_PER_MINUTE
});

const answerLearning = (card: Card, rating: Rating, opts: DeckOptions, ctx: SchedulerContext): AnswerResult => {
  const relearning = card.type === "relearning";
  const steps = relearning ? opts.relearningSteps : opts.learningSteps;
  const type: Card["type"] = relearning ? "relearning" : "learning";
  const left = card.left > 0 ? card.left : steps.length;

  if (rating === 1) {
    const delay = steps[0] ?? 1;
    return { card: enterLearning(card, steps, steps.length, delay, ctx, type), becameLeech: false, loggedInterval: -delay };
  }
  if (rating === 2) {
    const delay = hardDelayMinutes(steps, left);
    return { card: enterLearning(card, steps, left, delay, ctx, type), becameLeech: false, loggedInterval: -delay };
  }
  if (rating === 4) {
    const ivl = relearning ? Math.max(card.interval + 1, opts.minLapseInterval + 1) : opts.easyInterval;
    const next = graduate(card, ivl, opts, ctx, !relearning);
    return { card: next, becameLeech: false, loggedInterval: next.interval };
  }
  // Good
  const remaining = left - 1;
  if (remaining <= 0 || steps.length === 0) {
    const ivl = relearning ? Math.max(card.interval, opts.minLapseInterval) : opts.graduatingInterval;
    const next = graduate(card, ivl, opts, ctx, !relearning);
    return { card: next, becameLeech: false, loggedInterval: next.interval };
  }
  const delay = stepDelayMinutes(steps, remaining);
  return { card: enterLearning(card, steps, remaining, delay, ctx, type), becameLeech: false, loggedInterval: -delay };
};

const answerReview = (card: Card, rating: Rating, opts: DeckOptions, ctx: SchedulerContext): AnswerResult => {
  if (rating === 1) {
    const lapses = card.lapses + 1;
    const ease = Math.max(MIN_EASE, card.ease - 200);
    const interval = lapseInterval(card, opts);
    const becameLeech = lapses >= opts.leechThreshold && (lapses - opts.leechThreshold) % Math.max(1, Math.ceil(opts.leechThreshold / 2)) === 0;
    const base: Card = { ...card, lapses, ease, interval };
    if (opts.relearningSteps.length > 0) {
      const delay = opts.relearningSteps[0] ?? 10;
      const next = enterLearning(base, opts.relearningSteps, opts.relearningSteps.length, delay, ctx, "relearning");
      return { card: becameLeech && opts.leechAction === "suspend" ? { ...next, queue: "suspended", originalQueue: "learn" } : next, becameLeech, loggedInterval: -delay };
    }
    const next: Card = { ...base, type: "review", queue: "review", due: ctx.today + interval, left: 0 };
    return { card: becameLeech && opts.leechAction === "suspend" ? { ...next, queue: "suspended", originalQueue: "review" } : next, becameLeech, loggedInterval: interval };
  }
  const ivls = reviewIntervals(card, opts, ctx.today);
  const chosen = rating === 2 ? ivls.hard : rating === 3 ? ivls.good : ivls.easy;
  const interval = fuzzInterval(chosen, ctx.random);
  const easeDelta = rating === 2 ? -150 : rating === 4 ? 150 : 0;
  return {
    card: { ...card, type: "review", queue: "review", interval, ease: Math.max(MIN_EASE, card.ease + easeDelta), due: ctx.today + interval, left: 0 },
    becameLeech: false,
    loggedInterval: interval
  };
};

/**
 * Pure scheduling transition. Returns the updated card (reps/modifiedAt included) without touching storage.
 */
export const answerCard = (card: Card, rating: Rating, opts: DeckOptions, ctx: SchedulerContext): AnswerResult => {
  const working: Card = card.queue === "buried" || card.queue === "suspended" ? { ...card, queue: card.originalQueue ?? "new", originalQueue: null } : card;
  const result = working.type === "review" ? answerReview(working, rating, opts, ctx) : answerLearning(working, rating, opts, ctx);
  return { ...result, card: { ...result.card, reps: card.reps + 1, modifiedAt: ctx.now } };
};

/* ---------- previews for the answer buttons ---------- */

const describe = (result: AnswerResult): string => (result.loggedInterval < 0 ? formatMinutes(-result.loggedInterval) : formatInterval(result.loggedInterval));

export const previewIntervals = (card: Card, opts: DeckOptions, ctx: SchedulerContext): IntervalPreview => {
  const noFuzz: SchedulerContext = { ...ctx, random: () => 0.5 };
  return {
    again: describe(answerCard(card, 1, opts, noFuzz)),
    hard: describe(answerCard(card, 2, opts, noFuzz)),
    good: describe(answerCard(card, 3, opts, noFuzz)),
    easy: describe(answerCard(card, 4, opts, noFuzz))
  };
};

/* ---------- queue helpers ---------- */

export const isLearningDue = (card: Card, now: number, learnAheadMinutes = 0): boolean => card.queue === "learn" && card.due <= now + learnAheadMinutes * MS_PER_MINUTE;

export const isReviewDue = (card: Card, today: number): boolean => card.queue === "review" && card.due <= today;

export const compareDue = (a: Card, b: Card): number => a.due - b.due || a.createdAt - b.createdAt || a.ord - b.ord;
