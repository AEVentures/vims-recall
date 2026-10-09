import { z } from "zod";
import { collection, type Collection } from "./collection";
import { CardSchema, DeckOptionsSchema, DeckSchema, NoteSchema, NoteTypeSchema, ReviewLogSchema, type DeckId, type NoteTypeId } from "@/domain/types";

const BackupSchema = z.object({
  format: z.literal("vims-recall"),
  version: z.literal(1),
  exportedAt: z.number(),
  decks: z.array(DeckSchema),
  deckOptions: z.array(DeckOptionsSchema),
  noteTypes: z.array(NoteTypeSchema),
  notes: z.array(NoteSchema),
  cards: z.array(CardSchema),
  revlog: z.array(ReviewLogSchema),
  media: z.array(z.object({ name: z.string(), mime: z.string(), dataBase64: z.string() }))
});
export type Backup = z.infer<typeof BackupSchema>;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });

const base64ToBlob = (b64: string, mime: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

/** Full-collection JSON backup (schedule, history, media included). */
export const exportBackup = async (col: Collection = collection): Promise<Blob> => new Blob([await exportBackupJson(col)], { type: "application/json" });

export const exportBackupJson = async (col: Collection = collection): Promise<string> => {
  const raw = col.raw;
  const mediaRows = await raw.media.toArray();
  const media = await Promise.all(mediaRows.map(async (m) => ({ name: m.name, mime: m.mime, dataBase64: await blobToBase64(m.blob) })));
  const backup: Backup = {
    format: "vims-recall",
    version: 1,
    exportedAt: Date.now(),
    decks: await raw.decks.toArray(),
    deckOptions: await raw.deckOptions.toArray(),
    noteTypes: await raw.noteTypes.toArray(),
    notes: await raw.notes.toArray(),
    cards: await raw.cards.toArray(),
    revlog: await raw.revlog.toArray(),
    media
  };
  return JSON.stringify(backup);
};

export interface ImportSummary {
  decks: number;
  notes: number;
  cards: number;
  revlog: number;
}

/**
 * Restore a backup. `mode: "merge"` upserts by id (existing scheduling is overwritten by the backup);
 * `mode: "replace"` wipes the collection first.
 */
export const importBackup = async (text: string, mode: "merge" | "replace", col: Collection = collection): Promise<ImportSummary> => {
  const parsed = BackupSchema.parse(JSON.parse(text));
  const raw = col.raw;
  if (mode === "replace") await col.wipe();
  await raw.transaction("rw", [raw.decks, raw.deckOptions, raw.noteTypes, raw.notes, raw.cards, raw.revlog, raw.media, raw.config], async () => {
    await raw.deckOptions.bulkPut(parsed.deckOptions);
    await raw.decks.bulkPut(parsed.decks);
    await raw.noteTypes.bulkPut(parsed.noteTypes);
    await raw.notes.bulkPut(parsed.notes);
    await raw.cards.bulkPut(parsed.cards);
    await raw.revlog.bulkPut(parsed.revlog);
    await raw.media.bulkPut(parsed.media.map((m) => ({ name: m.name, mime: m.mime, blob: base64ToBlob(m.dataBase64, m.mime), createdAt: Date.now() })));
  });
  await col.ensureInitialized();
  const maxPos = parsed.cards.reduce((m, c) => (c.queue === "new" ? Math.max(m, c.due) : m), 0);
  const cfg = await col.config();
  if (cfg.nextNewPosition <= maxPos) await col.updateConfig({ nextNewPosition: maxPos + 1 });
  return { decks: parsed.decks.length, notes: parsed.notes.length, cards: parsed.cards.length, revlog: parsed.revlog.length };
};

/* ---------------- delimited text ---------------- */

export interface TextImportOptions {
  deckId: DeckId;
  noteTypeId: NoteTypeId;
  delimiter: "tab" | "comma" | "semicolon";
  /** treat the first row as a header */
  skipHeader: boolean;
  /** 1-based column index whose contents become tags, or null */
  tagsColumn: number | null;
  /** allow HTML in fields (otherwise it is escaped) */
  allowHtml: boolean;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** RFC4180-ish parser supporting quoted fields with embedded delimiters/newlines. */
export const parseDelimited = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim().length > 0)) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim().length > 0)) rows.push(row);
  return rows;
};

export const importDelimitedText = async (text: string, opts: TextImportOptions, col: Collection = collection): Promise<{ added: number; skipped: number; errors: string[] }> => {
  const delimiter = opts.delimiter === "tab" ? "\t" : opts.delimiter === "comma" ? "," : ";";
  const rows = parseDelimited(text.replace(/^\uFEFF/, "").replace(/^#.*\n/gm, ""), delimiter);
  const body = opts.skipHeader ? rows.slice(1) : rows;
  const noteType = await col.getNoteType(opts.noteTypeId);
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const [i, cols] of body.entries()) {
    const tags = opts.tagsColumn && cols[opts.tagsColumn - 1] ? [cols[opts.tagsColumn - 1] ?? ""] : [];
    const tagIdx = opts.tagsColumn === null ? -1 : opts.tagsColumn - 1;
    const fieldCols = cols.filter((_c, idx) => idx !== tagIdx);
    const fields = noteType.fields.map((_f, idx) => {
      const v = fieldCols[idx] ?? "";
      return opts.allowHtml ? v : escapeHtml(v).replace(/\n/g, "<br>");
    });
    try {
      await col.addNote({ noteTypeId: noteType.id, deckId: opts.deckId, fields, tags });
      added++;
    } catch (err) {
      skipped++;
      if (errors.length < 10) errors.push(`Row ${i + 1 + (opts.skipHeader ? 1 : 0)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { added, skipped, errors };
};

/** Export notes of a deck (and subdecks) as tab-separated text: fields…, tags. */
export const exportDeckAsText = async (deckId: DeckId, col: Collection = collection): Promise<Blob> => {
  const deck = await col.getDeck(deckId);
  const ids = new Set(await col.deckAndChildrenIds(deck));
  const cards = (await col.allCards()).filter((c) => ids.has(c.deckId));
  const noteIds = [...new Set(cards.map((c) => c.noteId))];
  const notes = (await col.allNotes()).filter((n) => noteIds.includes(n.id));
  const quote = (s: string): string => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = notes.map((n) => [...n.fields.map(quote), n.tags.join(" ")].join("\t"));
  return new Blob([`#separator:tab\n#html:true\n${lines.join("\n")}\n`], { type: "text/plain" });
};
