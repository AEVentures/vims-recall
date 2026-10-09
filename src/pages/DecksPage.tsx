import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, MoreHorizontal, Play } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Dialog, DialogContent, DialogFooter, Input, Label } from "@/components/ui";
import { DeckMenu } from "@/components/DeckMenu";
import { collection } from "@/data/collection";
import type { Deck, DeckCounts, DeckId } from "@/domain/types";
import { useDeckCounts, useDecks } from "@/hooks/useCollection";
import { cn, errorMessage } from "@/lib/utils";

interface DeckNode {
  deck: Deck;
  depth: number;
  hasChildren: boolean;
  visible: boolean;
}

const buildTree = (decks: readonly Deck[]): DeckNode[] => {
  const sorted = [...decks].sort((a, b) => a.name.localeCompare(b.name));
  const collapsedPrefixes: string[] = [];
  return sorted.map((deck) => {
    const parts = deck.name.split("::");
    const depth = parts.length - 1;
    const parent = parts.slice(0, -1).join("::");
    const hasChildren = sorted.some((d) => d.name.startsWith(`${deck.name}::`));
    const visible = !collapsedPrefixes.some((p) => deck.name.startsWith(`${p}::`));
    if (deck.collapsed) collapsedPrefixes.push(deck.name);
    void parent;
    return { deck, depth, hasChildren, visible };
  });
};

const Count = ({ value, tone }: { value: number; tone: "new" | "learn" | "review" }): JSX.Element => (
  <span className={cn("w-10 text-right tabular-nums text-sm", value === 0 ? "text-muted-foreground/40" : tone === "new" ? "text-easy" : tone === "learn" ? "text-again" : "text-good")}>{value}</span>
);

const EMPTY: DeckCounts = { newCount: 0, learnCount: 0, reviewCount: 0 };

export const DecksPage = (): JSX.Element => {
  const decks = useDecks();
  const counts = useDeckCounts();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tree = useMemo(() => buildTree(decks ?? []), [decks]);

  const totals = useMemo(() => {
    const t = { newCount: 0, learnCount: 0, reviewCount: 0 };
    for (const node of tree) {
      if (node.depth !== 0) continue;
      const c = counts?.get(node.deck.id) ?? EMPTY;
      t.newCount += c.newCount;
      t.learnCount += c.learnCount;
      t.reviewCount += c.reviewCount;
    }
    return t;
  }, [tree, counts]);

  const create = async (): Promise<void> => {
    try {
      const deck = await collection.createDeck(name);
      setCreating(false);
      setName("");
      setError(null);
      navigate(`/study/${deck.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggle = async (deck: Deck): Promise<void> => {
    await collection.updateDeck(deck.id, { collapsed: !deck.collapsed });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Decks</h1>
          <p className="text-sm text-muted-foreground">
            Due today: <span className="text-easy">{totals.newCount} new</span> · <span className="text-again">{totals.learnCount} learning</span> · <span className="text-good">{totals.reviewCount} review</span>
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <FolderPlus /> Create deck
        </Button>
      </div>

      <div className="glass rounded-xl overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b border-white/5">
          <span>Deck</span>
          <span className="w-10 text-right">New</span>
          <span className="w-10 text-right">Learn</span>
          <span className="w-10 text-right">Due</span>
          <span className="w-24" />
        </div>
        {decks === undefined ? (
          <div className="p-4 space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <ul role="list">
            {tree
              .filter((n) => n.visible)
              .map(({ deck, depth, hasChildren }) => {
                const c = counts?.get(deck.id) ?? EMPTY;
                const due = c.newCount + c.learnCount + c.reviewCount;
                const short = deck.name.split("::").pop() ?? deck.name;
                return (
                  <li key={deck.id} className="group grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 px-2 sm:px-4 py-1 border-b border-white/5 last:border-0 hover:bg-accent/40 transition-colors">
                    <div className="flex items-center min-w-0" style={{ paddingLeft: depth * 20 }}>
                      {hasChildren ? (
                        <button type="button" onClick={() => void toggle(deck)} aria-label={deck.collapsed ? "Expand" : "Collapse"} className="h-11 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground">
                          {deck.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      ) : (
                        <span className="w-8" />
                      )}
                      <Link to={`/study/${deck.id}`} className={cn("truncate py-2 text-sm font-medium hover:text-primary", due === 0 && "text-muted-foreground")}>
                        {short}
                      </Link>
                    </div>
                    <div className="hidden sm:contents">
                      <Count value={c.newCount} tone="new" />
                      <Count value={c.learnCount} tone="learn" />
                      <Count value={c.reviewCount} tone="review" />
                    </div>
                    <div className="flex items-center justify-end gap-1 sm:w-24">
                      <div className="sm:hidden flex items-center gap-2 mr-1">
                        <Count value={c.newCount} tone="new" />
                        <Count value={c.learnCount} tone="learn" />
                        <Count value={c.reviewCount} tone="review" />
                      </div>
                      <Button variant="ghost" size="icon" asChild aria-label={`Study ${deck.name}`}>
                        <Link to={`/study/${deck.id}`}>
                          <Play />
                        </Link>
                      </Button>
                      <DeckMenu deck={deck} trigger={<Button variant="ghost" size="icon" aria-label={`Options for ${deck.name}`}><MoreHorizontal /></Button>} />
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Create deck" description="Use :: to nest, e.g. Languages::Spanish">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="deck-name">Name</Label>
              <Input id="deck-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My deck" />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={name.trim().length === 0}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export type { DeckId };
