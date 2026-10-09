import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, EyeOff, Pencil, RotateCcw, Settings2, Shovel } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui";
import { CardRenderer } from "@/components/CardRenderer";
import { DeckOptionsDialog } from "@/components/DeckOptionsDialog";
import { EditNoteDialog } from "@/components/EditNoteDialog";
import type { DeckId, Rating } from "@/domain/types";
import { useStudySession } from "@/hooks/useStudySession";
import { cn } from "@/lib/utils";

const RATINGS: Array<{ rating: Rating; label: string; key: string; tone: string }> = [
  { rating: 1, label: "Again", key: "1", tone: "bg-again/15 text-again hover:bg-again/25 border-again/30" },
  { rating: 2, label: "Hard", key: "2", tone: "bg-hard/15 text-hard hover:bg-hard/25 border-hard/30" },
  { rating: 3, label: "Good", key: "3", tone: "bg-good/15 text-good hover:bg-good/25 border-good/30" },
  { rating: 4, label: "Easy", key: "4", tone: "bg-easy/15 text-easy hover:bg-easy/25 border-easy/30" }
];

export const StudyPage = (): JSX.Element => {
  const { deckId } = useParams<{ deckId: DeckId }>();
  const session = useStudySession(deckId);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [options, setOptions] = useState(false);
  const { item, answerShown, showAnswer, answer, undo, bury, suspend, counts, deck, finished, loading, error } = session;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (editing || options) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!item) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!answerShown) showAnswer();
        else void answer(3);
        return;
      }
      if (answerShown && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void answer(Number(e.key) as Rating);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "z") void undo();
      else if (k === "e") setEditing(true);
      else if (k === "-") void bury();
      else if (k === "!") void suspend();
      else if (k === "o") setOptions(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [item, answerShown, showAnswer, answer, undo, bury, suspend, editing, options]);

  if (error) {
    return (
      <div className="glass rounded-xl p-6 space-y-3">
        <p className="text-destructive">{error}</p>
        <Button variant="secondary" onClick={() => navigate("/")}>
          Back to decks
        </Button>
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/">
          <ArrowLeft /> <span className="hidden sm:inline">Decks</span>
        </Link>
      </Button>
      <div className="min-w-0 text-center">
        <h1 className="truncate text-sm font-medium text-muted-foreground">{deck?.name ?? "…"}</h1>
        <p className="text-xs tabular-nums">
          <span className={cn("text-easy", item?.card.type === "new" && "underline underline-offset-4")}>{counts.newCount}</span> · <span className={cn("text-again", (item?.card.type === "learning" || item?.card.type === "relearning") && "underline underline-offset-4")}>{counts.learnCount}</span> ·{" "}
          <span className={cn("text-good", item?.card.type === "review" && "underline underline-offset-4")}>{counts.reviewCount}</span>
        </p>
      </div>
      <div className="flex items-center">
        <Button variant="ghost" size="icon" aria-label="Undo (Z)" title="Undo (Z)" disabled={!session.canUndo} onClick={() => void undo()}>
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Deck options (O)" title="Deck options (O)" onClick={() => setOptions(true)}>
          <Settings2 />
        </Button>
      </div>
    </div>
  );

  if (finished && !item) {
    return (
      <div className="space-y-6">
        {header}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass mx-auto max-w-xl rounded-2xl p-10 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good/15 text-good">
            <Check className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-semibold">Congratulations!</h2>
          <p className="text-muted-foreground">You have finished this deck for now. {session.reviewedThisSession > 0 ? `${session.reviewedThisSession} cards studied this session.` : ""}</p>
          {deck?.description ? <p className="text-sm text-muted-foreground whitespace-pre-wrap">{deck.description}</p> : null}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button asChild>
              <Link to="/">Back to decks</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link to={`/add?deck=${deckId ?? ""}`}>Add cards</Link>
            </Button>
            <Button variant="ghost" onClick={() => setOptions(true)}>
              Raise daily limits
            </Button>
          </div>
        </motion.div>
        {deck && options ? <DeckOptionsDialog deck={deck} open onOpenChange={(o) => { setOptions(o); if (!o) void session.refresh(); }} /> : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-4">
      {header}
      <div className="flex-1">
        <AnimatePresence mode="wait">
          {item && !loading ? (
            <motion.div key={item.card.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="glass mx-auto max-w-3xl rounded-2xl p-6 sm:p-10">
              <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {item.noteType.name}
                  {item.card.flag > 0 ? " · flagged" : ""}
                </span>
                <span className="tabular-nums">
                  {item.card.type === "new" ? "New" : item.card.type === "review" ? `Interval ${item.card.interval}d · ease ${(item.card.ease / 10).toFixed(0)}%` : "Learning"}
                </span>
              </div>
              <CardRenderer html={answerShown ? item.rendered.answer : item.rendered.question} css={item.rendered.css} className="text-center" />
            </motion.div>
          ) : (
            <div className="glass mx-auto max-w-3xl rounded-2xl p-10" aria-busy="true">
              <div className="h-6 w-2/3 mx-auto rounded bg-muted/40 animate-pulse" />
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-white/5 bg-background/90 px-4 py-3 backdrop-blur-xl sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto max-w-3xl">
          {!answerShown ? (
            <Button size="lg" className="h-14 w-full text-base" onClick={showAnswer} disabled={!item}>
              Show answer <kbd className="ml-2 rounded bg-white/15 px-1.5 text-[11px] font-normal">space</kbd>
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ rating, label, key, tone }) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => void answer(rating)}
                  className={cn("flex h-16 flex-col items-center justify-center rounded-xl border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tone)}
                >
                  <span className="text-[11px] font-normal opacity-80 tabular-nums">{item?.preview[label.toLowerCase() as keyof typeof item.preview]}</span>
                  {label}
                  <span className="sr-only">shortcut {key}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-1 text-muted-foreground">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={!item} title="Edit (E)">
              <Pencil /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void bury()} disabled={!item} title="Bury (-)">
              <Shovel /> Bury
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void suspend()} disabled={!item} title="Suspend (!)">
              <EyeOff /> Suspend
            </Button>
          </div>
        </div>
      </div>

      {item && editing ? <EditNoteDialog noteId={item.note.id} open onOpenChange={(o) => { setEditing(o); if (!o) void session.refresh(); }} /> : null}
      {deck && options ? <DeckOptionsDialog deck={deck} open onOpenChange={(o) => { setOptions(o); if (!o) void session.refresh(); }} /> : null}
    </div>
  );
};
