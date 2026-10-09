import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter } from "@/components/ui";
import { NoteEditor } from "@/components/NoteEditor";
import { TagInput } from "@/components/TagInput";
import { collection } from "@/data/collection";
import type { Note, NoteId, NoteType } from "@/domain/types";
import { errorMessage } from "@/lib/utils";

interface EditNoteDialogProps {
  noteId: NoteId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const EditNoteDialog = ({ noteId, open, onOpenChange }: EditNoteDialogProps): JSX.Element => {
  const [note, setNote] = useState<Note | null>(null);
  const [noteType, setNoteType] = useState<NoteType | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const n = await collection.getNote(noteId);
      const nt = await collection.getNoteType(n.noteTypeId);
      if (!active) return;
      setNote(n);
      setNoteType(nt);
      setFields(n.fields);
      setTags(n.tags);
    })().catch((err: unknown) => setError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [noteId]);

  const save = async (): Promise<void> => {
    try {
      await collection.updateNote(noteId, { fields, tags });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit note" description={noteType?.name ?? ""} className="max-w-2xl">
        {note && noteType ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <NoteEditor noteType={noteType} fields={fields} onChange={setFields} autoFocus />
            <TagInput value={tags} onChange={setTags} />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="h-40 rounded-md bg-muted/40 animate-pulse" />
        )}
      </DialogContent>
    </Dialog>
  );
};
