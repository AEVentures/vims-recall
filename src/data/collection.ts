import { db, type RecallDatabase } from "./db";
import { DEFAULT_DECK_ID, DEFAULT_OPTIONS_ID, builtinNoteTypes, defaultDeckOptions } from "@/domain/defaults";
import { newCardId, newDeckId, newDeckOptionsId, newLogId, newNoteId, newNoteTypeId } from "@/domain/ids";
import { answerCard as scheduleAnswer, compareDue, isLearningDue, isReviewDue } from "@/domain/scheduler";
import { plainText, requiredCardOrds, stripHtml } from "@/domain/template";
import { dayIndex, dayStart } from "@/domain/time";
import {
  CardSchema,
  DeckOptionsSchema,
  DeckSchema,
  NoteSchema,
  NoteTypeSchema,
  type Card,
  type CardId,
  type CollectionConfig,
  type Deck,
  type DeckCounts,
  type DeckId,
  type DeckOptions,
  type DeckOptionsId,
  type Note,
  type NoteId,
  type NoteType,
  type NoteTypeId,
  type Rating,
  type ReviewLog
} from "@/domain/types";

export class CollectionError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT") {
    super(message);
    this.name = "CollectionError";
  }
}

const LEECH_TAG = "leech";

export class Collection {
  constructor(private readonly store: RecallDatabase = db) {}

  /* ---------------- bootstrap ---------------- */

  async ensureInitialized(now = Date.now()): Promise<CollectionConfig> {
    return this.store.transaction("rw", [this.store.config, this.store.deckOptions, this.store.decks, this.store.noteTypes], async () => {
      const existing = await this.store.config.get("collection");
      if (existing) return existing.value;
      const config: CollectionConfig = { rolloverHour: 4, createdAt: now, lastDeckId: DEFAULT_DECK_ID as DeckId, lastNoteTypeId: null, nextNewPosition: 0, lastUnburyDay: dayIndex(now, 4) };
      await this.store.deckOptions.put(defaultDeckOptions());
      await this.store.decks.put({ id: DEFAULT_DECK_ID as DeckId, name: "Default", description: "", optionsId: DEFAULT_OPTIONS_ID, collapsed: false, createdAt: now, modifiedAt: now });
      await this.store.noteTypes.bulkPut(builtinNoteTypes(now));
      await this.store.config.put({ key: "collection", value: config });
      return config;
    });
  }

  async config(): Promise<CollectionConfig> {
    const row = await this.store.config.get("collection");
    return row ? row.value : this.ensureInitialized();
  }

  async updateConfig(patch: Partial<CollectionConfig>): Promise<CollectionConfig> {
    const current = await this.config();
    const next = { ...current, ...patch };
    await this.store.config.put({ key: "collection", value: next });
    return next;
  }

  async today(now = Date.now()): Promise<number> {
    const cfg = await this.config();
    return dayIndex(now, cfg.rolloverHour);
  }

  /* ---------------- decks ---------------- */

  async listDecks(): Promise<Deck[]> {
    const decks = await this.store.decks.toArray();
    return decks.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getDeck(id: DeckId): Promise<Deck> {
    const deck = await this.store.decks.get(id);
    if (!deck) throw new CollectionError(`Deck ${id} not found`, "NOT_FOUND");
    return deck;
  }

  async createDeck(name: string, now = Date.now()): Promise<Deck> {
    const clean = name.trim().replace(/\s*::\s*/g, "::");
    if (clean.length === 0) throw new CollectionError("Deck name is required", "INVALID");
    const existing = await this.store.decks.where("name").equals(clean).first();
    if (existing) return existing;
    // ensure parents exist
    const parts = clean.split("::");
    let created: Deck | null = null;
    for (let i = 1; i <= parts.length; i++) {
      const partial = parts.slice(0, i).join("::");
      const found = await this.store.decks.where("name").equals(partial).first();
      if (found) {
        created = found;
        continue;
      }
      const deck = DeckSchema.parse({ id: newDeckId(), name: partial, description: "", optionsId: DEFAULT_OPTIONS_ID, collapsed: false, createdAt: now, modifiedAt: now });
      await this.store.decks.put(deck);
      created = deck;
    }
    if (!created) throw new CollectionError("Failed to create deck", "INVALID");
    return created;
  }

  async renameDeck(id: DeckId, newName: string, now = Date.now()): Promise<void> {
    const deck = await this.getDeck(id);
    const clean = newName.trim();
    if (clean.length === 0) throw new CollectionError("Deck name is required", "INVALID");
    const all = await this.store.decks.toArray();
    const children = all.filter((d) => d.name.startsWith(`${deck.name}::`));
    await this.store.transaction("rw", this.store.decks, async () => {
      await this.store.decks.update(id, { name: clean, modifiedAt: now });
      for (const child of children) await this.store.decks.update(child.id, { name: clean + child.name.slice(deck.name.length), modifiedAt: now });
    });
  }

  async updateDeck(id: DeckId, patch: Partial<Pick<Deck, "description" | "optionsId" | "collapsed">>, now = Date.now()): Promise<void> {
    await this.getDeck(id);
    await this.store.decks.update(id, { ...patch, modifiedAt: now });
  }

  /** Deletes the deck, its subdecks, and all cards/notes within. */
  async deleteDeck(id: DeckId): Promise<{ cards: number; notes: number }> {
    const deck = await this.getDeck(id);
    const ids = await this.deckAndChildrenIds(deck);
    return this.store.transaction("rw", [this.store.decks, this.store.cards, this.store.notes, this.store.revlog], async () => {
      const cards = await this.store.cards.where("deckId").anyOf(ids).toArray();
      const noteIds = [...new Set(cards.map((c) => c.noteId))];
      await this.store.cards.bulkDelete(cards.map((c) => c.id));
      await this.store.revlog.where("deckId").anyOf(ids).delete();
      let notesDeleted = 0;
      for (const noteId of noteIds) {
        const remaining = await this.store.cards.where("noteId").equals(noteId).count();
        if (remaining === 0) {
          await this.store.notes.delete(noteId);
          notesDeleted++;
        }
      }
      await this.store.decks.bulkDelete(ids);
      const remainingDecks = await this.store.decks.count();
      if (remainingDecks === 0) await this.store.decks.put({ id: DEFAULT_DECK_ID as DeckId, name: "Default", description: "", optionsId: DEFAULT_OPTIONS_ID, collapsed: false, createdAt: Date.now(), modifiedAt: Date.now() });
      return { cards: cards.length, notes: notesDeleted };
    });
  }

  async deckAndChildrenIds(deck: Deck): Promise<DeckId[]> {
    const all = await this.store.decks.toArray();
    return all.filter((d) => d.id === deck.id || d.name.startsWith(`${deck.name}::`)).map((d) => d.id);
  }

  /* ---------------- deck options ---------------- */

  async listDeckOptions(): Promise<DeckOptions[]> {
    return this.store.deckOptions.toArray();
  }

  async getDeckOptions(id: DeckOptionsId): Promise<DeckOptions> {
    const opts = await this.store.deckOptions.get(id);
    return opts ?? defaultDeckOptions();
  }

  async optionsForDeck(deckId: DeckId): Promise<DeckOptions> {
    const deck = await this.getDeck(deckId);
    return this.getDeckOptions(deck.optionsId);
  }

  async saveDeckOptions(opts: DeckOptions): Promise<void> {
    await this.store.deckOptions.put(DeckOptionsSchema.parse(opts));
  }

  async createDeckOptions(name: string, base?: DeckOptions): Promise<DeckOptions> {
    const opts = { ...(base ?? defaultDeckOptions()), id: newDeckOptionsId(), name: name.trim() || "New preset" };
    await this.store.deckOptions.put(opts);
    return opts;
  }

  async deleteDeckOptions(id: DeckOptionsId): Promise<void> {
    if (id === DEFAULT_OPTIONS_ID) throw new CollectionError("Cannot delete the default preset", "INVALID");
    await this.store.transaction("rw", [this.store.deckOptions, this.store.decks], async () => {
      await this.store.decks.where("optionsId").equals(id).modify({ optionsId: DEFAULT_OPTIONS_ID });
      await this.store.deckOptions.delete(id);
    });
  }

  /* ---------------- note types ---------------- */

  async listNoteTypes(): Promise<NoteType[]> {
    const types = await this.store.noteTypes.toArray();
    return types.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getNoteType(id: NoteTypeId): Promise<NoteType> {
    const nt = await this.store.noteTypes.get(id);
    if (!nt) throw new CollectionError(`Note type ${id} not found`, "NOT_FOUND");
    return nt;
  }

  async createNoteType(input: Omit<NoteType, "id" | "createdAt" | "modifiedAt">, now = Date.now()): Promise<NoteType> {
    const nt = NoteTypeSchema.parse({ ...input, id: newNoteTypeId(), createdAt: now, modifiedAt: now });
    await this.store.noteTypes.put(nt);
    return nt;
  }

  /**
   * Save an edited note type. Field additions/removals are applied to every note of this type
   * (by field ordinal), and cards are regenerated to match template changes.
   */
  async saveNoteType(next: NoteType, now = Date.now()): Promise<void> {
    const parsed = NoteTypeSchema.parse({ ...next, modifiedAt: now });
    const prev = await this.getNoteType(parsed.id);
    await this.store.transaction("rw", [this.store.noteTypes, this.store.notes, this.store.cards, this.store.config], async () => {
      await this.store.noteTypes.put(parsed);
      if (prev.fields.length === parsed.fields.length && prev.templates.length === parsed.templates.length && prev.templates.every((t, i) => t.qfmt === parsed.templates[i]?.qfmt)) return;
      const notes = await this.store.notes.where("noteTypeId").equals(parsed.id).toArray();
      for (const note of notes) {
        const fields = parsed.fields.map((_f, i) => note.fields[i] ?? "");
        const updated: Note = { ...note, fields, sortField: plainText(fields[parsed.sortFieldOrd] ?? ""), modifiedAt: now };
        await this.store.notes.put(updated);
        await this.syncCardsForNote(updated, parsed, null, now);
      }
    });
  }

  async deleteNoteType(id: NoteTypeId): Promise<void> {
    const count = await this.store.notes.where("noteTypeId").equals(id).count();
    if (count > 0) throw new CollectionError(`Note type is used by ${count} notes`, "CONFLICT");
    const total = await this.store.noteTypes.count();
    if (total <= 1) throw new CollectionError("At least one note type is required", "INVALID");
    await this.store.noteTypes.delete(id);
  }

  /* ---------------- notes & cards ---------------- */

  async addNote(input: { noteTypeId: NoteTypeId; deckId: DeckId; fields: string[]; tags?: string[] }, now = Date.now()): Promise<{ note: Note; cards: Card[] }> {
    const noteType = await this.getNoteType(input.noteTypeId);
    await this.getDeck(input.deckId);
    const fields = noteType.fields.map((_f, i) => input.fields[i] ?? "");
    if (fields.every((f) => stripHtml(f).length === 0)) throw new CollectionError("Note is empty", "INVALID");
    const note = NoteSchema.parse({
      id: newNoteId(),
      noteTypeId: noteType.id,
      fields,
      tags: normalizeTags(input.tags ?? []),
      sortField: plainText(fields[noteType.sortFieldOrd] ?? ""),
      createdAt: now,
      modifiedAt: now
    });
    const ords = requiredCardOrds(note, noteType);
    if (ords.length === 0) throw new CollectionError(noteType.isCloze ? "Add at least one cloze deletion, e.g. {{c1::text}}" : "The front of the card is empty", "INVALID");
    return this.store.transaction("rw", [this.store.notes, this.store.cards, this.store.config], async () => {
      await this.store.notes.put(note);
      const cards = await this.syncCardsForNote(note, noteType, input.deckId, now);
      await this.updateConfig({ lastDeckId: input.deckId, lastNoteTypeId: noteType.id });
      return { note, cards };
    });
  }

  async updateNote(noteId: NoteId, patch: { fields?: string[]; tags?: string[] }, now = Date.now()): Promise<Note> {
    const note = await this.getNote(noteId);
    const noteType = await this.getNoteType(note.noteTypeId);
    const fields = patch.fields ? noteType.fields.map((_f, i) => patch.fields?.[i] ?? "") : note.fields;
    const updated = NoteSchema.parse({ ...note, fields, tags: patch.tags ? normalizeTags(patch.tags) : note.tags, sortField: plainText(fields[noteType.sortFieldOrd] ?? ""), modifiedAt: now });
    await this.store.transaction("rw", [this.store.notes, this.store.cards, this.store.config], async () => {
      await this.store.notes.put(updated);
      await this.syncCardsForNote(updated, noteType, null, now);
    });
    return updated;
  }

  async getNote(id: NoteId): Promise<Note> {
    const note = await this.store.notes.get(id);
    if (!note) throw new CollectionError(`Note ${id} not found`, "NOT_FOUND");
    return note;
  }

  async deleteNotes(noteIds: NoteId[]): Promise<void> {
    await this.store.transaction("rw", [this.store.notes, this.store.cards, this.store.revlog], async () => {
      const cards = await this.store.cards.where("noteId").anyOf(noteIds).toArray();
      await this.store.revlog.where("cardId").anyOf(cards.map((c) => c.id)).delete();
      await this.store.cards.bulkDelete(cards.map((c) => c.id));
      await this.store.notes.bulkDelete(noteIds);
    });
  }

  /**
   * Make the cards table match the ordinals the note requires. Existing cards keep their scheduling.
   * `deckId` is required when creating the first cards; later additions inherit the deck of a sibling.
   */
  private async syncCardsForNote(note: Note, noteType: NoteType, deckId: DeckId | null, now: number): Promise<Card[]> {
    const existing = await this.store.cards.where("noteId").equals(note.id).toArray();
    const required = new Set(requiredCardOrds(note, noteType));
    const targetDeck = deckId ?? existing[0]?.deckId;
    if (!targetDeck) throw new CollectionError("No deck for note", "INVALID");
    const toDelete = existing.filter((c) => !required.has(c.ord));
    if (toDelete.length > 0 && toDelete.length === existing.length && required.size === 0) {
      // keep at least one card so the note is never orphaned; it will be empty but visible in the browser
      toDelete.pop();
    }
    await this.store.cards.bulkDelete(toDelete.map((c) => c.id));
    const kept = existing.filter((c) => !toDelete.includes(c));
    const have = new Set(kept.map((c) => c.ord));
    const created: Card[] = [];
    const cfg = await this.config();
    let position = cfg.nextNewPosition;
    for (const ord of required) {
      if (have.has(ord)) continue;
      const card = CardSchema.parse({
        id: newCardId(),
        noteId: note.id,
        deckId: targetDeck,
        ord,
        type: "new",
        queue: "new",
        due: position++,
        interval: 0,
        ease: 0,
        reps: 0,
        lapses: 0,
        left: 0,
        originalQueue: null,
        flag: 0,
        createdAt: now,
        modifiedAt: now
      });
      created.push(card);
    }
    if (created.length > 0) {
      await this.store.cards.bulkPut(created);
      await this.updateConfig({ nextNewPosition: position });
    }
    return [...kept, ...created];
  }

  async getCard(id: CardId): Promise<Card> {
    const card = await this.store.cards.get(id);
    if (!card) throw new CollectionError(`Card ${id} not found`, "NOT_FOUND");
    return card;
  }

  async cardsForNote(noteId: NoteId): Promise<Card[]> {
    return this.store.cards.where("noteId").equals(noteId).sortBy("ord");
  }

  async moveCards(cardIds: CardId[], deckId: DeckId, now = Date.now()): Promise<void> {
    await this.getDeck(deckId);
    await this.store.cards.where("id").anyOf(cardIds).modify({ deckId, modifiedAt: now });
  }

  async setSuspended(cardIds: CardId[], suspended: boolean, now = Date.now()): Promise<void> {
    await this.store.cards
      .where("id")
      .anyOf(cardIds)
      .modify((card: Card) => {
        if (suspended && card.queue !== "suspended") {
          card.originalQueue = card.queue === "buried" ? card.originalQueue : card.queue;
          card.queue = "suspended";
        } else if (!suspended && card.queue === "suspended") {
          card.queue = card.originalQueue ?? (card.type === "new" ? "new" : card.type === "review" ? "review" : "learn");
          card.originalQueue = null;
        }
        card.modifiedAt = now;
      });
  }

  async buryCards(cardIds: CardId[], now = Date.now()): Promise<void> {
    await this.store.cards
      .where("id")
      .anyOf(cardIds)
      .modify((card: Card) => {
        if (card.queue === "suspended" || card.queue === "buried") return;
        card.originalQueue = card.queue;
        card.queue = "buried";
        card.modifiedAt = now;
      });
  }

  async unburyAll(now = Date.now()): Promise<void> {
    await this.store.cards
      .where("queue")
      .equals("buried")
      .modify((card: Card) => {
        card.queue = card.originalQueue ?? (card.type === "new" ? "new" : card.type === "review" ? "review" : "learn");
        card.originalQueue = null;
        card.modifiedAt = now;
      });
  }

  async setFlag(cardIds: CardId[], flag: number, now = Date.now()): Promise<void> {
    await this.store.cards.where("id").anyOf(cardIds).modify({ flag, modifiedAt: now });
  }

  async forgetCards(cardIds: CardId[], now = Date.now()): Promise<void> {
    const cfg = await this.config();
    let position = cfg.nextNewPosition;
    await this.store.cards
      .where("id")
      .anyOf(cardIds)
      .modify((card: Card) => {
        card.type = "new";
        card.queue = "new";
        card.due = position++;
        card.interval = 0;
        card.ease = 0;
        card.left = 0;
        card.originalQueue = null;
        card.modifiedAt = now;
      });
    await this.updateConfig({ nextNewPosition: position });
  }

  async setDueDate(cardIds: CardId[], daysFromToday: number, now = Date.now()): Promise<void> {
    const today = await this.today(now);
    await this.store.cards
      .where("id")
      .anyOf(cardIds)
      .modify((card: Card) => {
        card.type = "review";
        card.queue = "review";
        card.due = today + Math.max(0, Math.round(daysFromToday));
        card.interval = Math.max(1, card.interval || Math.round(daysFromToday) || 1);
        if (card.ease === 0) card.ease = 2500;
        card.left = 0;
        card.originalQueue = null;
        card.modifiedAt = now;
      });
  }

  /* ---------------- studying ---------------- */

  private async dailyIntroducedCounts(deckIds: DeckId[], now: number): Promise<{ newToday: number; reviewsToday: number }> {
    const cfg = await this.config();
    const start = dayStart(now, cfg.rolloverHour);
    const logs = await this.store.revlog.where("time").aboveOrEqual(start).toArray();
    const set = new Set(deckIds);
    const scoped = logs.filter((l) => set.has(l.deckId));
    const newToday = scoped.filter((l) => l.type === "new").length;
    const reviewsToday = scoped.filter((l) => l.type === "review").length;
    return { newToday, reviewsToday };
  }

  private async maybeAutoUnbury(now: number): Promise<void> {
    const cfg = await this.config();
    const today = dayIndex(now, cfg.rolloverHour);
    if (cfg.lastUnburyDay < today) {
      await this.unburyAll(now);
      await this.updateConfig({ lastUnburyDay: today });
    }
  }

  async deckCounts(deckId: DeckId, now = Date.now()): Promise<DeckCounts> {
    await this.maybeAutoUnbury(now);
    const deck = await this.getDeck(deckId);
    const opts = await this.getDeckOptions(deck.optionsId);
    const ids = await this.deckAndChildrenIds(deck);
    const cfg = await this.config();
    const today = dayIndex(now, cfg.rolloverHour);
    const cards = await this.store.cards.where("deckId").anyOf(ids).toArray();
    const { newToday, reviewsToday } = await this.dailyIntroducedCounts(ids, now);
    const newAvailable = cards.filter((c) => c.queue === "new").length;
    const learnCount = cards.filter((c) => c.queue === "learn" && c.due < dayStart(now, cfg.rolloverHour) + 86_400_000).length;
    const reviewAvailable = cards.filter((c) => isReviewDue(c, today)).length;
    return {
      newCount: Math.min(newAvailable, Math.max(0, opts.newPerDay - newToday)),
      learnCount,
      reviewCount: Math.min(reviewAvailable, Math.max(0, opts.reviewsPerDay - reviewsToday))
    };
  }

  async allDeckCounts(now = Date.now()): Promise<Map<DeckId, DeckCounts>> {
    const decks = await this.listDecks();
    const result = new Map<DeckId, DeckCounts>();
    for (const deck of decks) result.set(deck.id, await this.deckCounts(deck.id, now));
    return result;
  }

  /**
   * Next card to study in a deck tree. Order: due learning → due reviews → new cards,
   * with learning cards that come due interleaved as time passes. Falls back to the
   * learn-ahead window when nothing else remains.
   */
  async nextCard(deckId: DeckId, now = Date.now()): Promise<Card | null> {
    await this.maybeAutoUnbury(now);
    const deck = await this.getDeck(deckId);
    const opts = await this.getDeckOptions(deck.optionsId);
    const ids = await this.deckAndChildrenIds(deck);
    const cfg = await this.config();
    const today = dayIndex(now, cfg.rolloverHour);
    const cards = await this.store.cards.where("deckId").anyOf(ids).toArray();
    const { newToday, reviewsToday } = await this.dailyIntroducedCounts(ids, now);

    const learn = cards.filter((c) => isLearningDue(c, now)).sort(compareDue);
    if (learn[0]) return learn[0];

    if (reviewsToday < opts.reviewsPerDay) {
      const reviews = cards.filter((c) => isReviewDue(c, today)).sort((a, b) => a.due - b.due || hash(a.id) - hash(b.id));
      if (reviews[0]) return reviews[0];
    }

    if (newToday < opts.newPerDay) {
      const fresh = cards.filter((c) => c.queue === "new");
      if (opts.newCardOrder === "random") fresh.sort((a, b) => hash(a.id) - hash(b.id));
      else fresh.sort(compareDue);
      if (fresh[0]) return fresh[0];
    }

    const ahead = cards.filter((c) => isLearningDue(c, now, opts.learnAheadLimit)).sort(compareDue);
    return ahead[0] ?? null;
  }

  async answerCard(cardId: CardId, rating: Rating, timeTakenMs: number, now = Date.now()): Promise<Card> {
    const card = await this.getCard(cardId);
    const deck = await this.getDeck(card.deckId);
    const opts = await this.getDeckOptions(deck.optionsId);
    const cfg = await this.config();
    const today = dayIndex(now, cfg.rolloverHour);
    const result = scheduleAnswer(card, rating, opts, { now, today, random: Math.random });
    const log: ReviewLog = {
      id: newLogId(),
      cardId: card.id,
      deckId: card.deckId,
      time: now,
      rating,
      type: card.type,
      interval: result.loggedInterval,
      lastInterval: card.interval,
      ease: result.card.ease,
      timeTakenMs: Math.min(timeTakenMs, opts.maxAnswerSeconds * 1000)
    };
    await this.store.transaction("rw", [this.store.cards, this.store.revlog, this.store.notes], async () => {
      await this.store.cards.put(result.card);
      await this.store.revlog.put(log);
      if (result.becameLeech) {
        const note = await this.store.notes.get(card.noteId);
        if (note && !note.tags.includes(LEECH_TAG)) await this.store.notes.update(note.id, { tags: [...note.tags, LEECH_TAG], modifiedAt: now });
      }
      if (card.type === "new" && opts.buryNewSiblings) await this.burySiblings(result.card, "new", now);
      if (card.type === "review" && opts.buryReviewSiblings) await this.burySiblings(result.card, "review", now);
    });
    return result.card;
  }

  private async burySiblings(card: Card, queue: "new" | "review", now: number): Promise<void> {
    const siblings = await this.store.cards.where("noteId").equals(card.noteId).toArray();
    const ids = siblings.filter((s) => s.id !== card.id && s.queue === queue).map((s) => s.id);
    if (ids.length > 0) await this.buryCards(ids, now);
  }

  /** Undo the most recent review of a card by restoring the pre-review state recorded in the log. */
  async undoLastAnswer(previous: Card, logTime: number): Promise<void> {
    await this.store.transaction("rw", [this.store.cards, this.store.revlog], async () => {
      await this.store.cards.put(previous);
      await this.store.revlog.where("cardId").equals(previous.id).and((l) => l.time === logTime).delete();
    });
  }

  async latestLogForCard(cardId: CardId): Promise<ReviewLog | undefined> {
    const logs = await this.store.revlog.where("cardId").equals(cardId).sortBy("time");
    return logs[logs.length - 1];
  }

  /* ---------------- browsing ---------------- */

  async allCards(): Promise<Card[]> {
    return this.store.cards.toArray();
  }

  async allNotes(): Promise<Note[]> {
    return this.store.notes.toArray();
  }

  async allTags(): Promise<string[]> {
    const notes = await this.store.notes.toArray();
    return [...new Set(notes.flatMap((n) => n.tags))].sort();
  }

  async revlogSince(since: number): Promise<ReviewLog[]> {
    return this.store.revlog.where("time").aboveOrEqual(since).toArray();
  }

  async allRevlog(): Promise<ReviewLog[]> {
    return this.store.revlog.toArray();
  }

  /* ---------------- media ---------------- */

  async putMedia(name: string, blob: Blob, now = Date.now()): Promise<void> {
    await this.store.media.put({ name, mime: blob.type, blob, createdAt: now });
  }

  async getMedia(name: string): Promise<Blob | undefined> {
    const row = await this.store.media.get(name);
    return row?.blob;
  }

  /* ---------------- bulk ---------------- */

  async wipe(): Promise<void> {
    await this.store.delete();
    await this.store.open();
  }

  get raw(): RecallDatabase {
    return this.store;
  }
}

export const normalizeTags = (tags: readonly string[]): string[] =>
  [...new Set(tags.flatMap((t) => t.split(/[\s,]+/)).map((t) => t.trim()).filter((t) => t.length > 0))].sort();

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const collection = new Collection();
