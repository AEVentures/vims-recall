import { beforeEach, describe, expect, it } from "vitest";
import { Collection, CollectionError } from "./collection";
import { RecallDatabase } from "./db";
import { BASIC_REVERSED_NOTE_TYPE_ID, CLOZE_NOTE_TYPE_ID, BASIC_NOTE_TYPE_ID } from "@/domain/defaults";
import { MS_PER_MINUTE } from "@/domain/time";

let col: Collection;
let counter = 0;

beforeEach(async () => {
  col = new Collection(new RecallDatabase(`test-${Date.now()}-${counter++}`));
  await col.ensureInitialized();
});

describe("decks", () => {
  it("creates parent decks implicitly", async () => {
    const child = await col.createDeck("Languages::Spanish::Verbs");
    const names = (await col.listDecks()).map((d) => d.name);
    expect(names).toContain("Languages");
    expect(names).toContain("Languages::Spanish");
    expect(child.name).toBe("Languages::Spanish::Verbs");
  });

  it("renames subdecks along with their parent", async () => {
    const parent = await col.createDeck("A");
    await col.createDeck("A::B");
    await col.renameDeck(parent.id, "Z");
    const names = (await col.listDecks()).map((d) => d.name).sort();
    expect(names).toEqual(["Default", "Z", "Z::B"]);
  });
});

describe("notes & cards", () => {
  it("generates one card per non-empty template", async () => {
    const deck = await col.createDeck("D");
    const one = await col.addNote({ noteTypeId: BASIC_REVERSED_NOTE_TYPE_ID, deckId: deck.id, fields: ["Q", ""] });
    expect(one.cards).toHaveLength(1);
    const two = await col.addNote({ noteTypeId: BASIC_REVERSED_NOTE_TYPE_ID, deckId: deck.id, fields: ["Q", "A"] });
    expect(two.cards).toHaveLength(2);
  });

  it("adds and removes cards when a note is edited", async () => {
    const deck = await col.createDeck("D");
    const { note } = await col.addNote({ noteTypeId: CLOZE_NOTE_TYPE_ID, deckId: deck.id, fields: ["{{c1::a}}", ""] });
    expect(await col.cardsForNote(note.id)).toHaveLength(1);
    await col.updateNote(note.id, { fields: ["{{c1::a}} {{c2::b}}", ""] });
    expect(await col.cardsForNote(note.id)).toHaveLength(2);
    await col.updateNote(note.id, { fields: ["{{c2::b}}", ""] });
    const remaining = await col.cardsForNote(note.id);
    expect(remaining.map((c) => c.ord)).toEqual([1]);
  });

  it("rejects empty notes", async () => {
    const deck = await col.createDeck("D");
    await expect(col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: ["", ""] })).rejects.toBeInstanceOf(CollectionError);
  });

  it("normalizes tags", async () => {
    const deck = await col.createDeck("D");
    const { note } = await col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: ["Q", "A"], tags: ["b a", "a", " c,d"] });
    expect(note.tags).toEqual(["a", "b", "c", "d"]);
  });
});

describe("studying", () => {
  it("serves new cards in order and respects the daily limit", async () => {
    const deck = await col.createDeck("D");
    const opts = await col.optionsForDeck(deck.id);
    await col.saveDeckOptions({ ...opts, newPerDay: 2 });
    for (let i = 0; i < 3; i++) await col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: [`Q${i}`, "A"] });
    const now = Date.now();
    expect((await col.deckCounts(deck.id, now)).newCount).toBe(2);
    const first = await col.nextCard(deck.id, now);
    expect(first).not.toBeNull();
    if (!first) return;
    await col.answerCard(first.id, 3, 1000, now);
    const second = await col.nextCard(deck.id, now + 1000);
    expect(second?.id).not.toBe(first.id);
    if (!second) return;
    await col.answerCard(second.id, 3, 1000, now + 1000);
    // new limit exhausted; the learning cards are due in 10 minutes, so the learn-ahead window serves the earliest one
    const ahead = await col.nextCard(deck.id, now + 2000);
    expect(ahead?.id).toBe(first.id);
    expect((await col.deckCounts(deck.id, now + 2000)).newCount).toBe(0);
    // 10 minutes later the first learning card is genuinely due
    const later = await col.nextCard(deck.id, now + 10 * MS_PER_MINUTE + 1);
    expect(later?.id).toBe(first.id);
  });

  it("records a review log and schedules reviews on day boundaries", async () => {
    const deck = await col.createDeck("D");
    const { cards } = await col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: ["Q", "A"] });
    const card = cards[0];
    if (!card) throw new Error("no card");
    const now = Date.now();
    const graduated = await col.answerCard(card.id, 4, 1500, now);
    expect(graduated.type).toBe("review");
    const today = await col.today(now);
    // easy interval is 4 days, fuzzed by ±1
    expect(graduated.due).toBeGreaterThanOrEqual(today + 3);
    expect(graduated.due).toBeLessThanOrEqual(today + 5);
    const logs = await col.allRevlog();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.rating).toBe(4);
    expect((await col.deckCounts(deck.id, now)).reviewCount).toBe(0);
    const later = now + 6 * 86_400_000;
    expect((await col.deckCounts(deck.id, later)).reviewCount).toBe(1);
  });

  it("suspends and unsuspends cards", async () => {
    const deck = await col.createDeck("D");
    const { cards } = await col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: ["Q", "A"] });
    const id = cards[0]?.id;
    if (!id) throw new Error("no card");
    await col.setSuspended([id], true);
    expect(await col.nextCard(deck.id)).toBeNull();
    await col.setSuspended([id], false);
    expect((await col.nextCard(deck.id))?.id).toBe(id);
  });

  it("undo restores the card and removes the log", async () => {
    const deck = await col.createDeck("D");
    const { cards } = await col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: ["Q", "A"] });
    const card = cards[0];
    if (!card) throw new Error("no card");
    const now = Date.now();
    await col.answerCard(card.id, 3, 500, now);
    await col.undoLastAnswer(card, now);
    expect((await col.getCard(card.id)).type).toBe("new");
    expect(await col.allRevlog()).toHaveLength(0);
  });
});
