import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, Input, Label, Select, Switch } from "@/components/ui";
import { collection } from "@/data/collection";
import { DEFAULT_OPTIONS_ID } from "@/domain/defaults";
import { DeckOptionsSchema, type Deck, type DeckOptions, type DeckOptionsId } from "@/domain/types";
import { useDeckOptionsList } from "@/hooks/useCollection";
import { errorMessage } from "@/lib/utils";

interface DeckOptionsDialogProps {
  deck: Deck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const parseSteps = (text: string): number[] =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d+(?:\.\d+)?)(m|h|d)?$/i.exec(s);
      if (!m) return Number.NaN;
      const n = Number(m[1]);
      const unit = (m[2] ?? "m").toLowerCase();
      return unit === "h" ? n * 60 : unit === "d" ? n * 1440 : n;
    })
    .filter((n) => Number.isFinite(n) && n > 0);

const stepsToText = (steps: readonly number[]): string => steps.map((m) => (m % 1440 === 0 && m >= 1440 ? `${m / 1440}d` : m % 60 === 0 && m >= 60 ? `${m / 60}h` : `${m}m`)).join(" ");

interface NumberFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}

const NumberField = ({ id, label, hint, value, step = 1, onChange }: NumberFieldProps): JSX.Element => (
  <div className="space-y-1.5">
    <Label htmlFor={id} {...(hint ? { hint } : {})}>
      {label}
    </Label>
    <Input id={id} type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
  </div>
);

export const DeckOptionsDialog = ({ deck, open, onOpenChange }: DeckOptionsDialogProps): JSX.Element => {
  const presets = useDeckOptionsList();
  const [opts, setOpts] = useState<DeckOptions | null>(null);
  const [learn, setLearn] = useState("");
  const [relearn, setRelearn] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void collection.getDeckOptions(deck.optionsId).then((o) => {
      setOpts(o);
      setLearn(stepsToText(o.learningSteps));
      setRelearn(stepsToText(o.relearningSteps));
    });
  }, [deck.optionsId]);

  const switchPreset = async (id: DeckOptionsId): Promise<void> => {
    await collection.updateDeck(deck.id, { optionsId: id });
    const o = await collection.getDeckOptions(id);
    setOpts(o);
    setLearn(stepsToText(o.learningSteps));
    setRelearn(stepsToText(o.relearningSteps));
  };

  const addPreset = async (): Promise<void> => {
    const name = window.prompt("Preset name");
    if (!name || !opts) return;
    const created = await collection.createDeckOptions(name, opts);
    await switchPreset(created.id);
  };

  const removePreset = async (): Promise<void> => {
    if (!opts || opts.id === DEFAULT_OPTIONS_ID) return;
    await collection.deleteDeckOptions(opts.id);
    await switchPreset(DEFAULT_OPTIONS_ID);
  };

  const save = async (): Promise<void> => {
    if (!opts) return;
    const learningSteps = parseSteps(learn);
    const relearningSteps = parseSteps(relearn);
    const parsed = DeckOptionsSchema.safeParse({ ...opts, learningSteps, relearningSteps });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    try {
      await collection.saveDeckOptions(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const set = <K extends keyof DeckOptions>(key: K, value: DeckOptions[K]): void => setOpts((o) => (o ? { ...o, [key]: value } : o));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Deck options" description={deck.name} className="max-w-2xl">
        {!opts ? (
          <div className="h-40 rounded-md bg-muted/40 animate-pulse" />
        ) : (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <section className="space-y-2">
              <Label htmlFor="preset">Preset</Label>
              <div className="flex gap-2">
                <Select id="preset" value={opts.id} onChange={(e) => void switchPreset(e.target.value as DeckOptionsId)}>
                  {(presets ?? [opts]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="secondary" onClick={() => void addPreset()}>
                  Clone
                </Button>
                <Button type="button" variant="ghost" disabled={opts.id === DEFAULT_OPTIONS_ID} onClick={() => void removePreset()}>
                  Remove
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Presets are shared: editing one changes every deck that uses it.</p>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="sm:col-span-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Daily limits</h3>
              <NumberField id="newPerDay" label="New cards/day" value={opts.newPerDay} onChange={(v) => set("newPerDay", v)} />
              <NumberField id="reviewsPerDay" label="Maximum reviews/day" value={opts.reviewsPerDay} onChange={(v) => set("reviewsPerDay", v)} />
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="sm:col-span-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">New cards</h3>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="learn" hint="e.g. 1m 10m 1h 1d">Learning steps</Label>
                <Input id="learn" value={learn} onChange={(e) => setLearn(e.target.value)} />
              </div>
              <NumberField id="grad" label="Graduating interval" hint="days" value={opts.graduatingInterval} onChange={(v) => set("graduatingInterval", v)} />
              <NumberField id="easyIvl" label="Easy interval" hint="days" value={opts.easyInterval} onChange={(v) => set("easyInterval", v)} />
              <div className="space-y-1.5">
                <Label htmlFor="order">Insertion order</Label>
                <Select id="order" value={opts.newCardOrder} onChange={(e) => set("newCardOrder", e.target.value === "random" ? "random" : "added")}>
                  <option value="added">Order added</option>
                  <option value="random">Random</option>
                </Select>
              </div>
              <NumberField id="ease" label="Starting ease" hint="permille, 2500 = 250%" value={opts.startingEase} step={10} onChange={(v) => set("startingEase", v)} />
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="sm:col-span-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Lapses</h3>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="relearn" hint="leave empty to skip relearning">Relearning steps</Label>
                <Input id="relearn" value={relearn} onChange={(e) => setRelearn(e.target.value)} />
              </div>
              <NumberField id="newInterval" label="New interval" hint="fraction of old interval kept" value={opts.newInterval} step={0.05} onChange={(v) => set("newInterval", v)} />
              <NumberField id="minLapse" label="Minimum interval" hint="days" value={opts.minLapseInterval} onChange={(v) => set("minLapseInterval", v)} />
              <NumberField id="leech" label="Leech threshold" hint="lapses" value={opts.leechThreshold} onChange={(v) => set("leechThreshold", v)} />
              <div className="space-y-1.5">
                <Label htmlFor="leechAction">Leech action</Label>
                <Select id="leechAction" value={opts.leechAction} onChange={(e) => set("leechAction", e.target.value === "suspend" ? "suspend" : "tag")}>
                  <option value="tag">Tag only</option>
                  <option value="suspend">Suspend card</option>
                </Select>
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="sm:col-span-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Advanced</h3>
              <NumberField id="maxIvl" label="Maximum interval" hint="days" value={opts.maxInterval} onChange={(v) => set("maxInterval", v)} />
              <NumberField id="easyBonus" label="Easy bonus" hint="multiplier" value={opts.easyBonus} step={0.05} onChange={(v) => set("easyBonus", v)} />
              <NumberField id="ivlMod" label="Interval modifier" hint="multiplier" value={opts.intervalModifier} step={0.05} onChange={(v) => set("intervalModifier", v)} />
              <NumberField id="hardIvl" label="Hard interval" hint="multiplier" value={opts.hardInterval} step={0.05} onChange={(v) => set("hardInterval", v)} />
              <NumberField id="learnAhead" label="Learn ahead limit" hint="minutes" value={opts.learnAheadLimit} onChange={(v) => set("learnAheadLimit", v)} />
              <NumberField id="maxAnswer" label="Max answer time" hint="seconds" value={opts.maxAnswerSeconds} onChange={(v) => set("maxAnswerSeconds", v)} />
              <div className="flex items-center justify-between sm:col-span-2 rounded-md border border-border px-3 py-2">
                <span className="text-sm">Bury new siblings until the next day</span>
                <Switch label="Bury new siblings" checked={opts.buryNewSiblings} onCheckedChange={(v) => set("buryNewSiblings", v)} />
              </div>
              <div className="flex items-center justify-between sm:col-span-2 rounded-md border border-border px-3 py-2">
                <span className="text-sm">Bury review siblings until the next day</span>
                <Switch label="Bury review siblings" checked={opts.buryReviewSiblings} onCheckedChange={(v) => set("buryReviewSiblings", v)} />
              </div>
            </section>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
