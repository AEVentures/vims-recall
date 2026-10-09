import Dexie, { type EntityTable } from "dexie";
import type { Card, CollectionConfig, Deck, DeckOptions, Media, Note, NoteType, ReviewLog } from "@/domain/types";

interface ConfigRow {
  key: "collection";
  value: CollectionConfig;
}

export class RecallDatabase extends Dexie {
  decks!: EntityTable<Deck, "id">;
  deckOptions!: EntityTable<DeckOptions, "id">;
  noteTypes!: EntityTable<NoteType, "id">;
  notes!: EntityTable<Note, "id">;
  cards!: EntityTable<Card, "id">;
  revlog!: EntityTable<ReviewLog, "id">;
  media!: EntityTable<Media, "name">;
  config!: EntityTable<ConfigRow, "key">;

  constructor(name = "vims-recall") {
    super(name);
    this.version(1).stores({
      decks: "id, name, optionsId",
      deckOptions: "id, name",
      noteTypes: "id, name",
      notes: "id, noteTypeId, sortField, modifiedAt, *tags",
      cards: "id, noteId, deckId, queue, due, [deckId+queue], [deckId+queue+due], [noteId+ord]",
      revlog: "id, cardId, deckId, time, [deckId+time]",
      media: "name",
      config: "key"
    });
  }
}

export const db = new RecallDatabase();
