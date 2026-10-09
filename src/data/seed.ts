import type { Collection } from "./collection";
import { BASIC_NOTE_TYPE_ID, BASIC_REVERSED_NOTE_TYPE_ID, CLOZE_NOTE_TYPE_ID } from "@/domain/defaults";

/**
 * A small starter deck that explains the app using the app. Only created on a fresh collection.
 */
export const seedStarterDeck = async (col: Collection): Promise<void> => {
  const cfg = await col.config();
  if (cfg.seeded) return;
  const decks = await col.listDecks();
  const notes = await col.allNotes();
  if (notes.length > 0 || decks.some((d) => d.name.startsWith("Getting Started"))) {
    await col.updateConfig({ seeded: true });
    return;
  }
  await col.updateConfig({ seeded: true });
  const deck = await col.createDeck("Getting Started");
  const basics: Array<[string, string]> = [
    ["What does spaced repetition do?", "It schedules each review just before you would forget, so you spend time only on what you are about to lose."],
    ["What happens when you press <b>Again</b>?", "The card returns to its first learning step and its ease drops. It will show up again in about a minute."],
    ["What happens when you press <b>Good</b>?", "The card moves to the next learning step, or—if it has graduated—its interval grows by its ease factor (250% by default)."],
    ["What is a card's <i>ease</i>?", "A multiplier applied to the interval after a successful review. Hard lowers it by 15%, Easy raises it by 15%. It never drops below 130%."],
    ["What is a <i>leech</i>?", "A card you keep forgetting. After 8 lapses it gets tagged <code>leech</code> so you can rewrite or delete it."],
    ["Keyboard: show answer", "<kbd>Space</kbd> or <kbd>Enter</kbd>"],
    ["Keyboard: grade a card", "<kbd>1</kbd> Again · <kbd>2</kbd> Hard · <kbd>3</kbd> Good · <kbd>4</kbd> Easy"],
    ["Keyboard: undo the last answer", "<kbd>Z</kbd>"]
  ];
  for (const [front, back] of basics) await col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: [front, back], tags: ["recall::intro"] });

  const reversed: Array<[string, string]> = [
    ["Deck", "A collection of cards you study together. Nest them with <code>Parent::Child</code>."],
    ["Note", "The facts you type in. One note can generate several cards."],
    ["Note type", "Defines a note's fields and the card templates that turn fields into cards."]
  ];
  for (const [front, back] of reversed) await col.addNote({ noteTypeId: BASIC_REVERSED_NOTE_TYPE_ID, deckId: deck.id, fields: [front, back], tags: ["recall::intro", "recall::terms"] });

  const clozes: string[] = [
    "A cloze deletion hides part of a sentence: {{c1::this part}} becomes the question and {{c2::this other part}} becomes a second card.",
    "The default learning steps are {{c1::1 minute}} and {{c2::10 minutes}}; after passing both, a card graduates with a {{c3::1-day}} interval.",
    "Press {{c1::Easy::a button}} on a new card and it skips the learning steps with a {{c2::4-day}} interval."
  ];
  for (const text of clozes) await col.addNote({ noteTypeId: CLOZE_NOTE_TYPE_ID, deckId: deck.id, fields: [text, ""], tags: ["recall::intro", "recall::cloze"] });
};
