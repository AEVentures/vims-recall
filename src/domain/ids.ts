import type { CardId, DeckId, DeckOptionsId, NoteId, NoteTypeId } from "./types";

const genId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const newDeckId = (): DeckId => genId() as DeckId;
export const newNoteId = (): NoteId => genId() as NoteId;
export const newCardId = (): CardId => genId() as CardId;
export const newNoteTypeId = (): NoteTypeId => genId() as NoteTypeId;
export const newDeckOptionsId = (): DeckOptionsId => genId() as DeckOptionsId;
export const newLogId = (): string => genId();
