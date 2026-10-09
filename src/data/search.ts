import { plainText } from "@/domain/template";
import type { Card, Deck, Note, NoteType } from "@/domain/types";

export interface BrowserRow {
  readonly card: Card;
  readonly note: Note;
  readonly noteType: NoteType;
  readonly deck: Deck;
  readonly sortField: string;
  readonly questionText: string;
  readonly answerText: string;
}

interface SearchTerm {
  readonly negate: boolean;
  readonly key: string | null;
  readonly value: string;
}

/** Tokenize an Anki-style query: `deck:Spanish tag:verb is:due "exact phrase" -excluded` */
export const parseQuery = (query: string): SearchTerm[] => {
  const terms: SearchTerm[] = [];
  const re = /(-)?(?:([a-zA-Z]+):)?(?:"([^"]*)"|(\S+))/g;
  for (const m of query.matchAll(re)) {
    const value = (m[3] ?? m[4] ?? "").trim();
    if (value.length === 0 && !m[2]) continue;
    terms.push({ negate: Boolean(m[1]), key: m[2]?.toLowerCase() ?? null, value });
  }
  return terms;
};

const matchesTerm = (row: BrowserRow, term: SearchTerm, today: number, now: number): boolean => {
  const v = term.value.toLowerCase();
  switch (term.key) {
    case "deck":
      return row.deck.name.toLowerCase() === v || row.deck.name.toLowerCase().startsWith(`${v}::`) || (v === "*" ? true : row.deck.name.toLowerCase().includes(v));
    case "tag":
      return v === "none" ? row.note.tags.length === 0 : row.note.tags.some((t) => t.toLowerCase() === v || t.toLowerCase().startsWith(`${v}::`));
    case "note":
      return row.noteType.name.toLowerCase() === v;
    case "card":
      return (row.noteType.templates[row.card.ord]?.name.toLowerCase() ?? "") === v || String(row.card.ord + 1) === v;
    case "is":
      switch (v) {
        case "new":
          return row.card.type === "new";
        case "learn":
          return row.card.type === "learning" || row.card.type === "relearning";
        case "review":
          return row.card.type === "review";
        case "due":
          return (row.card.queue === "review" && row.card.due <= today) || (row.card.queue === "learn" && row.card.due <= now);
        case "suspended":
          return row.card.queue === "suspended";
        case "buried":
          return row.card.queue === "buried";
        default:
          return false;
      }
    case "flag":
      return row.card.flag === Number(v);
    case "prop": {
      const m = /^(ivl|ease|reps|lapses|due)(<=|>=|<|>|=)(-?\d+(?:\.\d+)?)$/.exec(v);
      if (!m) return false;
      const field = m[1];
      const op = m[2];
      const num = Number(m[3]);
      const actual = field === "ivl" ? row.card.interval : field === "ease" ? row.card.ease / 1000 : field === "reps" ? row.card.reps : field === "lapses" ? row.card.lapses : row.card.queue === "review" ? row.card.due - today : Number.NaN;
      if (Number.isNaN(actual)) return false;
      return op === "<" ? actual < num : op === ">" ? actual > num : op === "<=" ? actual <= num : op === ">=" ? actual >= num : actual === num;
    }
    case "added": {
      const days = Number(v);
      return Number.isFinite(days) && row.note.createdAt >= now - days * 86_400_000;
    }
    default: {
      const hay = `${row.questionText} ${row.answerText} ${row.note.tags.join(" ")}`.toLowerCase();
      return hay.includes(v);
    }
  }
};

export const filterRows = (rows: readonly BrowserRow[], query: string, today: number, now: number): BrowserRow[] => {
  const terms = parseQuery(query);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => terms.every((t) => matchesTerm(row, t, today, now) !== t.negate));
};

export const buildRows = (cards: readonly Card[], notes: readonly Note[], noteTypes: readonly NoteType[], decks: readonly Deck[]): BrowserRow[] => {
  const noteMap = new Map(notes.map((n) => [n.id, n]));
  const typeMap = new Map(noteTypes.map((t) => [t.id, t]));
  const deckMap = new Map(decks.map((d) => [d.id, d]));
  const rows: BrowserRow[] = [];
  for (const card of cards) {
    const note = noteMap.get(card.noteId);
    const noteType = note ? typeMap.get(note.noteTypeId) : undefined;
    const deck = deckMap.get(card.deckId);
    if (!note || !noteType || !deck) continue;
    const plain = note.fields.map(plainText);
    rows.push({ card, note, noteType, deck, sortField: note.sortField, questionText: plain[0] ?? "", answerText: plain.slice(1).join(" ") });
  }
  return rows;
};
