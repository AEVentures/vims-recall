import type { DeckOptions, DeckOptionsId, NoteType, NoteTypeId } from "./types";

export const DEFAULT_OPTIONS_ID = "default-options" as DeckOptionsId;
export const DEFAULT_DECK_ID = "default-deck";

export const defaultDeckOptions = (id: DeckOptionsId = DEFAULT_OPTIONS_ID, name = "Default"): DeckOptions => ({
  id,
  name,
  newPerDay: 20,
  reviewsPerDay: 200,
  learningSteps: [1, 10],
  relearningSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2500,
  easyBonus: 1.3,
  intervalModifier: 1,
  hardInterval: 1.2,
  maxInterval: 36500,
  newInterval: 0,
  minLapseInterval: 1,
  leechThreshold: 8,
  leechAction: "tag",
  buryNewSiblings: false,
  buryReviewSiblings: false,
  newCardOrder: "added",
  learnAheadLimit: 20,
  maxAnswerSeconds: 60
});

export const DEFAULT_CSS = `.card {
  font-family: Inter, system-ui, sans-serif;
  font-size: 22px;
  text-align: center;
  color: inherit;
  background: transparent;
}`;

export const BASIC_NOTE_TYPE_ID = "nt-basic" as NoteTypeId;
export const BASIC_REVERSED_NOTE_TYPE_ID = "nt-basic-reversed" as NoteTypeId;
export const CLOZE_NOTE_TYPE_ID = "nt-cloze" as NoteTypeId;

export const builtinNoteTypes = (now: number): NoteType[] => [
  {
    id: BASIC_NOTE_TYPE_ID,
    name: "Basic",
    fields: [
      { name: "Front", ord: 0, sticky: false, rtl: false },
      { name: "Back", ord: 1, sticky: false, rtl: false }
    ],
    templates: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" }],
    css: DEFAULT_CSS,
    isCloze: false,
    sortFieldOrd: 0,
    createdAt: now,
    modifiedAt: now
  },
  {
    id: BASIC_REVERSED_NOTE_TYPE_ID,
    name: "Basic (and reversed card)",
    fields: [
      { name: "Front", ord: 0, sticky: false, rtl: false },
      { name: "Back", ord: 1, sticky: false, rtl: false }
    ],
    templates: [
      { name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" },
      { name: "Card 2", ord: 1, qfmt: "{{Back}}", afmt: "{{FrontSide}}<hr id=answer>{{Front}}" }
    ],
    css: DEFAULT_CSS,
    isCloze: false,
    sortFieldOrd: 0,
    createdAt: now,
    modifiedAt: now
  },
  {
    id: CLOZE_NOTE_TYPE_ID,
    name: "Cloze",
    fields: [
      { name: "Text", ord: 0, sticky: false, rtl: false },
      { name: "Back Extra", ord: 1, sticky: false, rtl: false }
    ],
    templates: [{ name: "Cloze", ord: 0, qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>{{Back Extra}}" }],
    css: DEFAULT_CSS,
    isCloze: true,
    sortFieldOrd: 0,
    createdAt: now,
    modifiedAt: now
  }
];
