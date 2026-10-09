import { describe, expect, it } from "vitest";
import { answerCard, fuzzInterval, previewIntervals, reviewIntervals } from "./scheduler";
import { defaultDeckOptions } from "./defaults";
import type { Card, CardId, DeckId, NoteId } from "./types";
import { MS_PER_MINUTE } from "./time";

const opts = defaultDeckOptions();
const now = Date.UTC(2026, 9, 9, 15, 0, 0);
const today = 20_000;
const ctx = { now, today, random: () => 0.5 };

const newCard = (overrides: Partial<Card> = {}): Card => ({
  id: "c1" as CardId,
  noteId: "n1" as NoteId,
  deckId: "d1" as DeckId,
  ord: 0,
  type: "new",
  queue: "new",
  due: 0,
  interval: 0,
  ease: 0,
  reps: 0,
  lapses: 0,
  left: 0,
  originalQueue: null,
  flag: 0,
  createdAt: now - 1000,
  modifiedAt: now - 1000,
  ...overrides
});

const reviewCard = (interval: number, ease = 2500, overrides: Partial<Card> = {}): Card =>
  newCard({ type: "review", queue: "review", interval, ease, due: today, reps: 5, ...overrides });

describe("learning", () => {
  it("Again on a new card enters first learning step", () => {
    const { card } = answerCard(newCard(), 1, opts, ctx);
    expect(card.type).toBe("learning");
    expect(card.queue).toBe("learn");
    expect(card.left).toBe(2);
    expect(card.due).toBe(now + 1 * MS_PER_MINUTE);
    expect(card.reps).toBe(1);
  });

  it("Good on a new card advances to second step, then graduates", () => {
    const first = answerCard(newCard(), 3, opts, ctx).card;
    expect(first.left).toBe(1);
    expect(first.due).toBe(now + 10 * MS_PER_MINUTE);
    const second = answerCard(first, 3, opts, ctx).card;
    expect(second.type).toBe("review");
    expect(second.interval).toBe(1);
    expect(second.ease).toBe(2500);
    expect(second.due).toBe(today + 1);
  });

  it("Easy on a new card graduates with the easy interval", () => {
    const { card } = answerCard(newCard(), 4, opts, ctx);
    expect(card.type).toBe("review");
    expect(card.interval).toBe(4);
  });

  it("Hard on the first step averages first two steps", () => {
    const { card } = answerCard(newCard(), 2, opts, ctx);
    expect(card.due).toBe(now + 5.5 * MS_PER_MINUTE);
    expect(card.left).toBe(2);
  });

  it("Hard with a single step uses 1.5x", () => {
    const single = { ...opts, learningSteps: [10] };
    const { card } = answerCard(newCard(), 2, single, ctx);
    expect(card.due).toBe(now + 15 * MS_PER_MINUTE);
  });
});

describe("review", () => {
  it("computes hard/good/easy intervals", () => {
    const ivls = reviewIntervals(reviewCard(10), opts, today);
    expect(ivls.hard).toBe(12);
    expect(ivls.good).toBe(25);
    expect(ivls.easy).toBe(33);
  });

  it("adds half the overdue delay for Good and all of it for Easy", () => {
    const ivls = reviewIntervals(reviewCard(10, 2500, { due: today - 4 }), opts, today);
    expect(ivls.good).toBe(30);
    expect(ivls.easy).toBe(Math.round(14 * 2.5 * 1.3));
  });

  it("Again lapses into relearning and drops ease by 200", () => {
    const { card } = answerCard(reviewCard(30), 1, opts, ctx);
    expect(card.type).toBe("relearning");
    expect(card.queue).toBe("learn");
    expect(card.lapses).toBe(1);
    expect(card.ease).toBe(2300);
    expect(card.interval).toBe(1);
    expect(card.due).toBe(now + 10 * MS_PER_MINUTE);
  });

  it("relearning Good returns to review with the lapsed interval", () => {
    const lapsed = answerCard(reviewCard(30), 1, opts, ctx).card;
    const { card } = answerCard(lapsed, 3, opts, ctx);
    expect(card.type).toBe("review");
    expect(card.interval).toBe(1);
    expect(card.due).toBe(today + 1);
  });

  it("Hard lowers ease, Easy raises it", () => {
    expect(answerCard(reviewCard(10), 2, opts, ctx).card.ease).toBe(2350);
    expect(answerCard(reviewCard(10), 4, opts, ctx).card.ease).toBe(2650);
  });

  it("ease never drops below 130%", () => {
    const { card } = answerCard(reviewCard(10, 1300), 1, opts, ctx);
    expect(card.ease).toBe(1300);
  });

  it("respects max interval", () => {
    const capped = { ...opts, maxInterval: 20 };
    const ivls = reviewIntervals(reviewCard(10), capped, today);
    expect(ivls.easy).toBe(20);
  });

  it("flags a leech at the threshold and suspends when configured", () => {
    const suspendOpts = { ...opts, leechThreshold: 2, leechAction: "suspend" as const };
    const once = answerCard(reviewCard(10, 2500, { lapses: 1 }), 1, suspendOpts, ctx);
    expect(once.becameLeech).toBe(true);
    expect(once.card.queue).toBe("suspended");
  });
});

describe("fuzz", () => {
  it("never fuzzes intervals under 2 days", () => {
    expect(fuzzInterval(1, () => 0.99)).toBe(1);
  });
  it("stays within the expected range", () => {
    for (const r of [0, 0.3, 0.7, 0.999]) {
      const v = fuzzInterval(100, () => r);
      expect(v).toBeGreaterThanOrEqual(95);
      expect(v).toBeLessThanOrEqual(105);
    }
  });
});

describe("previews", () => {
  it("describes button outcomes for a new card", () => {
    expect(previewIntervals(newCard(), opts, ctx)).toEqual({ again: "1m", hard: "6m", good: "10m", easy: "4d" });
  });
  it("describes button outcomes for a review card", () => {
    expect(previewIntervals(reviewCard(10), opts, ctx)).toEqual({ again: "10m", hard: "12d", good: "25d", easy: "1.1mo" });
  });
});
