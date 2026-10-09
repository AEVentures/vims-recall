import { strFromU8, unzipSync } from "fflate";
import type { Database, SqlJsStatic } from "sql.js";
import { z } from "zod";
import { collection, normalizeTags, type Collection } from "./collection";
import { DEFAULT_CSS, DEFAULT_DECK_ID, DEFAULT_OPTIONS_ID } from "@/domain/defaults";
import { plainText, requiredCardOrds } from "@/domain/template";
import { dayIndex, dayStart } from "@/domain/time";
import type { Card, CardId, CardType, CardQueue, Deck, DeckId, Note, NoteId, NoteType, NoteTypeId, Rating, ReviewLog } from "@/domain/types";

export class ApkgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApkgError";
  }
}

/* ---------- legacy (schema 11) JSON blobs stored in `col` ---------- */

const AnkiFieldSchema = z.object({ name: z.string(), ord: z.number().int(), sticky: z.boolean().optional(), rtl: z.boolean().optional() });
const AnkiTemplateSchema = z.object({ name: z.string(), ord: z.number().int(), qfmt: z.string(), afmt: z.string() });
const AnkiModelSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  type: z.number().int().optional(),
  flds: z.array(AnkiFieldSchema),
  tmpls: z.array(AnkiTemplateSchema),
  css: z.string().optional(),
  sortf: z.number().int().optional()
});
const AnkiDeckSchema = z.object({ id: z.coerce.number(), name: z.string(), desc: z.string().optional() });

type AnkiModel = z.infer<typeof AnkiModelSchema>;
type AnkiDeck = z.infer<typeof AnkiDeckSchema>;

export interface ApkgSummary {
  noteTypes: number;
  decks: number;
  notes: number;
  cards: number;
  revlog: number;
  media: number;
  warnings: string[];
}

export interface ApkgImportOptions {
  /** keep scheduling from the file (default) or import everything as new */
  keepScheduling: boolean;
}

const ntId = (mid: number): NoteTypeId => `anki-nt-${mid}` as NoteTypeId;
const deckId = (did: number): DeckId => `anki-deck-${did}` as DeckId;
const noteId = (nid: number): NoteId => `anki-note-${nid}` as NoteId;
const cardId = (cid: number): CardId => `anki-card-${cid}` as CardId;

const rows = <T>(db: Database, sql: string, map: (r: Record<string, unknown>) => T): T[] => {
  const out: T[] = [];
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) out.push(map(stmt.getAsObject() as Record<string, unknown>));
  } finally {
    stmt.free();
  }
  return out;
};

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v ?? 0));
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

const tableExists = (db: Database, name: string): boolean => rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`, (r) => str(r.name)).length > 0;

const pickCollectionFile = (files: Record<string, Uint8Array>): Uint8Array => {
  if (files["collection.anki21b"] && !files["collection.anki21"] && !files["collection.anki2"]) {
    throw new ApkgError("This .apkg uses Anki's newest compressed format. In Anki, export again with “Support older Anki versions” checked, then import that file.");
  }
  const bytes = files["collection.anki21"] ?? files["collection.anki2"];
  if (!bytes) throw new ApkgError("No collection database found inside the .apkg file.");
  return bytes;
};

const parseJsonMap = <T>(raw: string, schema: z.ZodType<T>, label: string, warnings: string[]): T[] => {
  if (!raw || raw === "{}") return [];
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return [];
  const out: T[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const r = schema.safeParse(value);
    if (r.success) out.push(r.data);
    else warnings.push(`Skipped ${label} ${key}: ${r.error.issues[0]?.message ?? "invalid"}`);
  }
  return out;
};

const toNoteType = (m: AnkiModel, now: number): NoteType => ({
  id: ntId(m.id),
  name: m.name,
  fields: m.flds.sort((a, b) => a.ord - b.ord).map((f, i) => ({ name: f.name, ord: i, sticky: f.sticky ?? false, rtl: f.rtl ?? false })),
  templates: m.tmpls.sort((a, b) => a.ord - b.ord).map((t, i) => ({ name: t.name, ord: i, qfmt: t.qfmt, afmt: t.afmt })),
  css: m.css && m.css.trim().length > 0 ? m.css : DEFAULT_CSS,
  isCloze: m.type === 1,
  sortFieldOrd: Math.min(m.sortf ?? 0, Math.max(0, m.flds.length - 1)),
  createdAt: now,
  modifiedAt: now
});

const toDeck = (d: AnkiDeck, now: number): Deck => ({
  id: d.id === 1 ? (DEFAULT_DECK_ID as DeckId) : deckId(d.id),
  name: d.name.replace(/\u001f/g, "::"),
  description: d.desc ?? "",
  optionsId: DEFAULT_OPTIONS_ID,
  collapsed: false,
  createdAt: now,
  modifiedAt: now
});

interface AnkiCardRow {
  id: number;
  nid: number;
  did: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: number;
  flags: number;
}

const convertCard = (c: AnkiCardRow, crtMs: number, rolloverHour: number, keep: boolean, now: number, fallbackPos: number): Card => {
  const did = c.odid !== 0 ? c.odid : c.did;
  const due = c.odid !== 0 ? c.odue : c.due;
  const base: Card = {
    id: cardId(c.id),
    noteId: noteId(c.nid),
    deckId: did === 1 ? (DEFAULT_DECK_ID as DeckId) : deckId(did),
    ord: c.ord,
    type: "new",
    queue: "new",
    due: fallbackPos,
    interval: 0,
    ease: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    originalQueue: null,
    flag: c.flags & 0b111,
    createdAt: c.id > 1_000_000_000_000 ? c.id : now,
    modifiedAt: now
  };
  if (!keep) return base;

  const type: CardType = c.type === 1 ? "learning" : c.type === 2 ? "review" : c.type === 3 ? "relearning" : "new";
  let queue: CardQueue = c.queue === 1 || c.queue === 3 ? "learn" : c.queue === 2 ? "review" : "new";
  let originalQueue: CardQueue | null = null;
  if (c.queue === -1) {
    originalQueue = type === "new" ? "new" : type === "review" ? "review" : "learn";
    queue = "suspended";
  } else if (c.queue === -2 || c.queue === -3) {
    originalQueue = type === "new" ? "new" : type === "review" ? "review" : "learn";
    queue = "buried";
  }
  const effectiveQueue = originalQueue ?? queue;
  let ourDue = fallbackPos;
  if (effectiveQueue === "review") ourDue = dayIndex(crtMs + due * 86_400_000 + 3_600_000, rolloverHour);
  else if (effectiveQueue === "learn") ourDue = c.queue === 3 || due < 1_000_000_000 ? dayStart(crtMs + due * 86_400_000 + 3_600_000, rolloverHour) + 8 * 3_600_000 : due * 1000;

  return {
    ...base,
    type,
    queue,
    originalQueue,
    due: ourDue,
    interval: Math.max(0, c.ivl),
    ease: type === "new" ? 0 : Math.max(1300, c.factor || 2500),
    reps: c.reps,
    lapses: c.lapses,
    left: c.left % 1000
  };
};

/**
 * Import an Anki .apkg (legacy schema with JSON models/decks, i.e. exported with "Support older Anki versions").
 * Re-importing the same file updates existing records rather than duplicating them.
 */
export const importApkg = async (bytes: Uint8Array, sql: SqlJsStatic, opts: ApkgImportOptions, col: Collection = collection, now = Date.now()): Promise<ApkgSummary> => {
  const warnings: string[] = [];
  const files = unzipSync(bytes);
  const dbBytes = pickCollectionFile(files);
  const db = new sql.Database(dbBytes);
  try {
    if (!tableExists(db, "col")) throw new ApkgError("Not an Anki collection (missing `col` table).");
    const colRow = rows(db, "SELECT crt, models, decks FROM col LIMIT 1", (r) => ({ crt: num(r.crt), models: str(r.models), decks: str(r.decks) }))[0];
    if (!colRow) throw new ApkgError("Empty collection.");

    const models = parseJsonMap(colRow.models, AnkiModelSchema, "note type", warnings);
    const decks = parseJsonMap(colRow.decks, AnkiDeckSchema, "deck", warnings);
    if (models.length === 0 && tableExists(db, "notetypes")) {
      throw new ApkgError("This .apkg stores note types in the newer binary format. In Anki, export again with “Support older Anki versions” checked.");
    }
    if (models.length === 0) throw new ApkgError("No note types found in the file.");

    const cfg = await col.config();
    const noteTypes = models.map((m) => toNoteType(m, now));
    const deckRecords = decks.map((d) => toDeck(d, now));
    const noteTypeMap = new Map(noteTypes.map((n) => [n.id, n]));

    const ankiNotes = rows(db, "SELECT id, mid, tags, flds FROM notes", (r) => ({ id: num(r.id), mid: num(r.mid), tags: str(r.tags), flds: str(r.flds) }));
    const notes: Note[] = [];
    for (const n of ankiNotes) {
      const nt = noteTypeMap.get(ntId(n.mid));
      if (!nt) {
        warnings.push(`Skipped note ${n.id}: unknown note type ${n.mid}`);
        continue;
      }
      const raw = n.flds.split("\u001f");
      const fields = nt.fields.map((_f, i) => raw[i] ?? "");
      notes.push({ id: noteId(n.id), noteTypeId: nt.id, fields, tags: normalizeTags([n.tags]), sortField: plainText(fields[nt.sortFieldOrd] ?? ""), createdAt: n.id > 1_000_000_000_000 ? n.id : now, modifiedAt: now });
    }
    const noteMap = new Map(notes.map((n) => [n.id, n]));

    const ankiCards = rows(db, "SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags FROM cards", (r) => ({
      id: num(r.id), nid: num(r.nid), did: num(r.did), ord: num(r.ord), type: num(r.type), queue: num(r.queue), due: num(r.due), ivl: num(r.ivl), factor: num(r.factor), reps: num(r.reps), lapses: num(r.lapses), left: num(r.left), odue: num(r.odue), odid: num(r.odid), flags: num(r.flags)
    }));
    let position = cfg.nextNewPosition;
    const cards: Card[] = [];
    const deckIds = new Set(deckRecords.map((d) => d.id));
    for (const c of ankiCards) {
      const note = noteMap.get(noteId(c.nid));
      if (!note) continue;
      const card = convertCard(c, colRow.crt * 1000, cfg.rolloverHour, opts.keepScheduling, now, position++);
      if (!deckIds.has(card.deckId)) {
        deckRecords.push({ id: card.deckId, name: `Imported ${c.did}`, description: "", optionsId: DEFAULT_OPTIONS_ID, collapsed: false, createdAt: now, modifiedAt: now });
        deckIds.add(card.deckId);
      }
      cards.push(card);
    }
    // Notes whose cards were missing (rare) still need at least one card so they appear in the browser.
    const notesWithCards = new Set(cards.map((c) => c.noteId));
    for (const note of notes) {
      if (notesWithCards.has(note.id)) continue;
      const nt = noteTypeMap.get(note.noteTypeId);
      if (!nt) continue;
      for (const ord of requiredCardOrds(note, nt)) {
        cards.push({ id: `${note.id}-c${ord}` as CardId, noteId: note.id, deckId: DEFAULT_DECK_ID as DeckId, ord, type: "new", queue: "new", due: position++, interval: 0, ease: 0, reps: 0, lapses: 0, left: 0, originalQueue: null, flag: 0, createdAt: now, modifiedAt: now });
      }
    }

    const cardIdSet = new Set(cards.map((c) => c.id));
    const cardDeck = new Map(cards.map((c) => [c.id, c.deckId]));
    const revlog: ReviewLog[] = opts.keepScheduling && tableExists(db, "revlog")
      ? rows(db, "SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog", (r) => ({ id: num(r.id), cid: num(r.cid), ease: num(r.ease), ivl: num(r.ivl), lastIvl: num(r.lastIvl), factor: num(r.factor), time: num(r.time), type: num(r.type) }))
          .filter((l) => cardIdSet.has(cardId(l.cid)) && l.ease >= 1 && l.ease <= 4)
          .map((l) => ({
            id: `anki-rev-${l.id}`,
            cardId: cardId(l.cid),
            deckId: cardDeck.get(cardId(l.cid)) ?? (DEFAULT_DECK_ID as DeckId),
            time: l.id,
            rating: l.ease as Rating,
            type: l.type === 1 || l.type === 3 ? "review" : l.type === 2 ? "relearning" : "learning",
            interval: l.ivl < 0 ? -(-l.ivl / 60) : l.ivl,
            lastInterval: l.lastIvl < 0 ? 0 : l.lastIvl,
            ease: l.factor,
            timeTakenMs: Math.max(0, l.time)
          }))
      : [];

    // media: `media` file maps "0" -> "name.png"
    const mediaEntries: Array<{ name: string; blob: Blob }> = [];
    const mediaIndex = files["media"];
    if (mediaIndex) {
      try {
        const map: unknown = JSON.parse(strFromU8(mediaIndex));
        if (map && typeof map === "object") {
          for (const [key, name] of Object.entries(map as Record<string, unknown>)) {
            const data = files[key];
            if (data && typeof name === "string") mediaEntries.push({ name, blob: new Blob([new Uint8Array(data)], { type: mimeFor(name) }) });
          }
        }
      } catch {
        warnings.push("Media index could not be read; media files were skipped.");
      }
    }

    const raw = col.raw;
    await raw.transaction("rw", [raw.noteTypes, raw.decks, raw.notes, raw.cards, raw.revlog, raw.media, raw.config], async () => {
      for (const nt of noteTypes) {
        const existing = await raw.noteTypes.get(nt.id);
        await raw.noteTypes.put(existing ? { ...nt, createdAt: existing.createdAt } : nt);
      }
      for (const d of deckRecords) {
        const existing = await raw.decks.get(d.id);
        const sameName = existing ? null : await raw.decks.where("name").equals(d.name).first();
        if (sameName && sameName.id !== d.id) {
          // deck with this name already exists locally: route imported cards into it
          for (const c of cards) if (c.deckId === d.id) c.deckId = sameName.id;
          continue;
        }
        await raw.decks.put(existing ? { ...existing, description: existing.description || d.description } : d);
      }
      await raw.notes.bulkPut(notes);
      const existingCards = new Map((await raw.cards.where("id").anyOf(cards.map((c) => c.id)).toArray()).map((c) => [c.id, c]));
      await raw.cards.bulkPut(cards.map((c) => (existingCards.has(c.id) && !opts.keepScheduling ? { ...existingCards.get(c.id)!, deckId: c.deckId, flag: c.flag } : c)));
      if (revlog.length > 0) await raw.revlog.bulkPut(revlog);
      if (mediaEntries.length > 0) await raw.media.bulkPut(mediaEntries.map((m) => ({ name: m.name, mime: m.blob.type, blob: m.blob, createdAt: now })));
    });
    await col.updateConfig({ nextNewPosition: position });

    return { noteTypes: noteTypes.length, decks: deckRecords.length, notes: notes.length, cards: cards.length, revlog: revlog.length, media: mediaEntries.length, warnings };
  } finally {
    db.close();
  }
};

const mimeFor = (name: string): string => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm" };
  return map[ext] ?? "application/octet-stream";
};
