import { z } from "zod";

export const DeckIdSchema = z.string().min(1).brand<"DeckId">();
export const NoteIdSchema = z.string().min(1).brand<"NoteId">();
export const CardIdSchema = z.string().min(1).brand<"CardId">();
export const NoteTypeIdSchema = z.string().min(1).brand<"NoteTypeId">();
export const DeckOptionsIdSchema = z.string().min(1).brand<"DeckOptionsId">();

export type DeckId = z.infer<typeof DeckIdSchema>;
export type NoteId = z.infer<typeof NoteIdSchema>;
export type CardId = z.infer<typeof CardIdSchema>;
export type NoteTypeId = z.infer<typeof NoteTypeIdSchema>;
export type DeckOptionsId = z.infer<typeof DeckOptionsIdSchema>;

export const RatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy */
export type Rating = z.infer<typeof RatingSchema>;

export const CardTypeSchema = z.enum(["new", "learning", "review", "relearning"]);
export type CardType = z.infer<typeof CardTypeSchema>;

export const CardQueueSchema = z.enum(["new", "learn", "review", "suspended", "buried"]);
export type CardQueue = z.infer<typeof CardQueueSchema>;

export const LeechActionSchema = z.enum(["suspend", "tag"]);
export const NewCardOrderSchema = z.enum(["added", "random"]);

export const DeckOptionsSchema = z.object({
  id: DeckOptionsIdSchema,
  name: z.string().min(1),
  newPerDay: z.number().int().min(0),
  reviewsPerDay: z.number().int().min(0),
  /** minutes */
  learningSteps: z.array(z.number().positive()).min(1),
  /** minutes */
  relearningSteps: z.array(z.number().positive()),
  /** days */
  graduatingInterval: z.number().int().min(1),
  /** days */
  easyInterval: z.number().int().min(1),
  /** permille, e.g. 2500 = 250% */
  startingEase: z.number().int().min(1300),
  easyBonus: z.number().min(1),
  intervalModifier: z.number().positive(),
  hardInterval: z.number().min(1),
  maxInterval: z.number().int().min(1),
  /** multiplier applied to the previous interval after a lapse */
  newInterval: z.number().min(0).max(1),
  minLapseInterval: z.number().int().min(1),
  leechThreshold: z.number().int().min(1),
  leechAction: LeechActionSchema,
  buryNewSiblings: z.boolean(),
  buryReviewSiblings: z.boolean(),
  newCardOrder: NewCardOrderSchema,
  /** minutes */
  learnAheadLimit: z.number().int().min(0),
  /** seconds; answers longer than this are clamped in stats */
  maxAnswerSeconds: z.number().int().min(5)
});
export type DeckOptions = z.infer<typeof DeckOptionsSchema>;

export const DeckSchema = z.object({
  id: DeckIdSchema,
  /** Hierarchical name separated by "::" e.g. "Languages::Spanish" */
  name: z.string().min(1),
  description: z.string(),
  optionsId: DeckOptionsIdSchema,
  collapsed: z.boolean(),
  createdAt: z.number(),
  modifiedAt: z.number()
});
export type Deck = z.infer<typeof DeckSchema>;

export const FieldDefSchema = z.object({
  name: z.string().min(1),
  ord: z.number().int().min(0),
  sticky: z.boolean(),
  rtl: z.boolean()
});
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const CardTemplateSchema = z.object({
  name: z.string().min(1),
  ord: z.number().int().min(0),
  /** Question (front) template */
  qfmt: z.string(),
  /** Answer (back) template */
  afmt: z.string()
});
export type CardTemplate = z.infer<typeof CardTemplateSchema>;

export const NoteTypeSchema = z.object({
  id: NoteTypeIdSchema,
  name: z.string().min(1),
  fields: z.array(FieldDefSchema).min(1),
  templates: z.array(CardTemplateSchema).min(1),
  css: z.string(),
  isCloze: z.boolean(),
  sortFieldOrd: z.number().int().min(0),
  createdAt: z.number(),
  modifiedAt: z.number()
});
export type NoteType = z.infer<typeof NoteTypeSchema>;

export const NoteSchema = z.object({
  id: NoteIdSchema,
  noteTypeId: NoteTypeIdSchema,
  fields: z.array(z.string()),
  tags: z.array(z.string()),
  /** plain-text copy of the sort field for fast browsing */
  sortField: z.string(),
  createdAt: z.number(),
  modifiedAt: z.number()
});
export type Note = z.infer<typeof NoteSchema>;

export const CardSchema = z.object({
  id: CardIdSchema,
  noteId: NoteIdSchema,
  deckId: DeckIdSchema,
  /** template ordinal (standard) or cloze number - 1 (cloze) */
  ord: z.number().int().min(0),
  type: CardTypeSchema,
  queue: CardQueueSchema,
  /**
   * new: insertion position
   * learn/relearn: epoch milliseconds
   * review: day index (days since epoch, local, rollover-adjusted)
   */
  due: z.number(),
  /** days */
  interval: z.number().min(0),
  /** permille */
  ease: z.number().int().min(0),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  /** remaining learning steps */
  left: z.number().int().min(0),
  /** queue to restore when unburying/unsuspending */
  originalQueue: CardQueueSchema.nullable(),
  flag: z.number().int().min(0).max(7),
  createdAt: z.number(),
  modifiedAt: z.number()
});
export type Card = z.infer<typeof CardSchema>;

export const ReviewLogSchema = z.object({
  id: z.string(),
  cardId: CardIdSchema,
  deckId: DeckIdSchema,
  time: z.number(),
  rating: RatingSchema,
  type: CardTypeSchema,
  /** days (negative = seconds, mirroring Anki's convention is avoided; we store minutes for learn) */
  interval: z.number(),
  lastInterval: z.number(),
  ease: z.number(),
  timeTakenMs: z.number().int().min(0)
});
export type ReviewLog = z.infer<typeof ReviewLogSchema>;

export const MediaSchema = z.object({
  name: z.string().min(1),
  mime: z.string(),
  blob: z.instanceof(Blob),
  createdAt: z.number()
});
export type Media = z.infer<typeof MediaSchema>;

export const CollectionConfigSchema = z.object({
  rolloverHour: z.number().int().min(0).max(23),
  createdAt: z.number(),
  lastDeckId: DeckIdSchema.nullable(),
  lastNoteTypeId: NoteTypeIdSchema.nullable(),
  nextNewPosition: z.number().int().min(0),
  /** the day index on which buried cards were last unburied */
  lastUnburyDay: z.number().int(),
  /** starter content has been created (or deliberately skipped) */
  seeded: z.boolean().optional()
});
export type CollectionConfig = z.infer<typeof CollectionConfigSchema>;

export interface DeckCounts {
  readonly newCount: number;
  readonly learnCount: number;
  readonly reviewCount: number;
}

export interface IntervalPreview {
  readonly again: string;
  readonly hard: string;
  readonly good: string;
  readonly easy: string;
}
