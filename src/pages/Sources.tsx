import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Plus, RefreshCw, Trash } from "lucide-react";
import { useState } from "react";
import { KIND_ICON, SourcePicker } from "../components/SourcePicker";
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Spinner, MissingKit } from "../components/ui";
import { db } from "../lib/db";
import { useKit } from "../lib/hooks";
import { runJob, useJob } from "../lib/jobs";
import { addSources, analyzeKit, type NewSource } from "../lib/study";

export default function Sources() {
  const { kitId, kit } = useKit();
  const sources = useLiveQuery(() => db.sources.where("kitId").equals(kitId).sortBy("createdAt"), [kitId]);
  const job = useJob(`kit:${kitId}`);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [items, setItems] = useState<NewSource[]>([]);
  const busy = !!job && !job.done;

  const add = () => {
    const toAdd = items;
    setItems([]);
    setAdding(false);
    runJob(`kit:${kitId}`, ({ signal, report }) => addSources(kitId, toAdd, (name, status) => report(`${status}${name === "kit" ? "" : `: ${name}`}`), signal));
  };

  const reanalyze = () =>
    runJob(`kit:${kitId}`, async ({ signal, report }) => {
      report("Mapping the key concepts");
      await db.kits.update(kitId, { status: "processing" });
      try {
        await analyzeKit(kitId, signal);
        await db.kits.update(kitId, { status: "ready", error: undefined });
      } catch (err) {
        await db.kits.update(kitId, { status: "error", error: (err as Error).message });
        throw err;
      }
    });

  const remove = async (id: string) => {
    if (!confirm("Remove this source? Existing flashcards and questions are kept.")) return;
    await db.sources.delete(id);
  };

  if (kit === null) return <MissingKit />;

  if (!kit || !sources) return <Spinner label="Loading" />;
  const totalChars = sources.reduce((n, s) => n + s.text.length, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Sources"
        subtitle={`${sources.length} sources · ~${Math.round(totalChars / 4 / 1000)}k tokens of material`}
        back={`/kit/${kitId}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={reanalyze} loading={busy} title="Re-map concepts after adding or removing material">
              <RefreshCw className="size-4" /> Re-map concepts
            </Button>
            <Button size="sm" onClick={() => setAdding(true)} disabled={busy}>
              <Plus className="size-4" /> Add material
            </Button>
          </>
        }
      />
      {busy && (
        <Card className="mb-4 p-4">
          <Spinner label={job.status} />
        </Card>
      )}
      {job?.error && <div className="mb-4"><ErrorBox error={job.error} /></div>}

      <div className="space-y-2">
        {sources.map((s) => (
          <Card key={s.id} className="overflow-hidden">
            <div className="flex cursor-pointer items-center gap-3 p-3" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className="text-brand-700 dark:text-brand-300">{KIND_ICON[s.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted">
                  {s.status === "ready" ? `${Math.round(s.text.length / 4).toLocaleString()} tokens · read by ${s.via ?? "?"}` : s.status}
                </div>
              </div>
              {s.status === "error" && <Badge tone="rose">error</Badge>}
              {(s.status === "processing" || s.status === "pending") && <Spinner />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(s.id);
                }}
                className="rounded p-1 text-muted hover:text-rose-600"
                aria-label="Remove source"
              >
                <Trash className="size-4" />
              </button>
              <ChevronDown className={clsx("size-4 text-muted transition", open === s.id && "rotate-180")} />
            </div>
            {open === s.id && (
              <div className="border-t border-theme p-3">
                {s.error ? <ErrorBox error={s.error} /> : <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-muted">{s.text || "(empty)"}</pre>}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add material">
        <div className="space-y-4">
          <SourcePicker items={items} onChange={setItems} />
          <Button className="w-full" onClick={add} disabled={!items.length}>
            Add and update kit
          </Button>
        </div>
      </Modal>
    </div>
  );
}
