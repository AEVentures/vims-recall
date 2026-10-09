import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Input, Label } from "@/components/ui";
import { normalizeTags } from "@/data/collection";
import { useTags } from "@/hooks/useCollection";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
}

export const TagInput = ({ value, onChange }: TagInputProps): JSX.Element => {
  const [draft, setDraft] = useState("");
  const all = useTags() ?? [];
  const suggestions = useMemo(() => (draft.length === 0 ? [] : all.filter((t) => t.toLowerCase().includes(draft.toLowerCase()) && !value.includes(t)).slice(0, 6)), [draft, all, value]);

  const commit = (text: string): void => {
    const next = normalizeTags([...value, text]);
    onChange(next);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="tags">Tags</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background/60 px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-accent" onClick={() => onChange(value.filter((v) => v !== t))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          id="tags"
          list="tag-suggestions"
          className="h-9 flex-1 min-w-[8rem] border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
          placeholder="Add tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " " || e.key === ",") && draft.trim().length > 0) {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim().length > 0 && commit(draft)}
        />
        <datalist id="tag-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </div>
  );
};
