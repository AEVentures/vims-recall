import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Dialog, DialogContent, DialogFooter, Input, Label, Textarea } from "@/components/ui";
import { DeckOptionsDialog } from "@/components/DeckOptionsDialog";
import { collection } from "@/data/collection";
import type { Deck } from "@/domain/types";
import { errorMessage } from "@/lib/utils";

interface DeckMenuProps {
  deck: Deck;
  trigger: ReactNode;
}

type Mode = null | "menu" | "rename" | "describe" | "options" | "delete";

export const DeckMenu = ({ deck, trigger }: DeckMenuProps): JSX.Element => {
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      setError(null);
      setMode(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <span onClick={() => setMode("menu")} onKeyDown={(e) => (e.key === "Enter" ? setMode("menu") : undefined)}>
        {trigger}
      </span>

      <Dialog open={mode === "menu"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent title={deck.name.split("::").pop() ?? deck.name} description={deck.name}>
          <div className="grid gap-2">
            <Button variant="secondary" onClick={() => setMode("options")}>Options</Button>
            <Button variant="secondary" onClick={() => { setName(deck.name); setMode("rename"); }}>Rename</Button>
            <Button variant="secondary" onClick={() => { setDescription(deck.description); setMode("describe"); }}>Description</Button>
            <Button variant="secondary" onClick={() => navigate(`/browse?q=${encodeURIComponent(`deck:"${deck.name}"`)}`)}>Browse cards</Button>
            <Button variant="secondary" onClick={() => navigate(`/add?deck=${deck.id}`)}>Add cards</Button>
            <Button variant="destructive" onClick={() => setMode("delete")}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "rename"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent title="Rename deck">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(() => collection.renameDeck(deck.id, name)); }}>
            <div className="space-y-2">
              <Label htmlFor="rename">Full name</Label>
              <Input id="rename" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "describe"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent title="Deck description" description="Shown on the deck overview before studying.">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(() => collection.updateDeck(deck.id, { description })); }}>
            <Textarea autoFocus value={description} onChange={(e) => setDescription(e.target.value)} rows={5} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "delete"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent title="Delete deck?" description={`"${deck.name}" and every subdeck, card, and note inside it will be permanently deleted.`}>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void run(async () => { await collection.deleteDeck(deck.id); navigate("/"); })}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {mode === "options" ? <DeckOptionsDialog deck={deck} open onOpenChange={(o) => !o && setMode(null)} /> : null}
    </>
  );
};
