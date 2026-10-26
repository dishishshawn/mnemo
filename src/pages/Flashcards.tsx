import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { Layers, Pencil, Plus, RotateCcw, Scan, Shuffle, Sparkles, Trash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FigureView } from "../components/FigureView";
import { InlineMarkdown } from "../components/Markdown";
import { Badge, Button, Card, Empty, ErrorBox, Field, inputClass, Modal, PageHeader, Progress, Segmented, Spinner, MissingKit } from "../components/ui";
import { db, newId, type Figure, type Flashcard } from "../lib/db";
import { candidatePages, makeDiagramCards, PAGES_PER_RUN } from "../lib/figures";
import { shuffle, useKit } from "../lib/hooks";
import { runJob, useJob } from "../lib/jobs";
import { formatInterval, isDue, newCard, preview, Rating, review, type Grade } from "../lib/srs";
import { generateFlashcards } from "../lib/study";

export default function Flashcards() {
  const { kitId, kit } = useKit();
  const cards = useLiveQuery(() => db.flashcards.where("kitId").equals(kitId).sortBy("createdAt"), [kitId]);
  const [mode, setMode] = useState<"review" | "browse">("review");
  const [more, setMore] = useState(false);
  const [focus, setFocus] = useState("");
  const [diagrams, setDiagrams] = useState(false);
  /** How the last diagram run went. Jobs vanish when they succeed, so the outcome is kept here. */
  const [diagramNote, setDiagramNote] = useState("");
  const job = useJob(`cards:${kitId}`);
  const diagramJob = useJob(`diagrams:${kitId}`);
  const figures = useLiveQuery(async () => new Map((await db.figures.where("kitId").equals(kitId).toArray()).map((f) => [f.id, f])), [kitId]);
  const scannable = useLiveQuery(() => candidatePages(kitId).then((ids) => ids.length), [kitId]);
  // A diagram card can only be shown where its image is; on another device it waits for sync.
  const usable = useMemo(() => (cards ?? []).filter((c) => !c.figure || !!figures?.get(c.figure.id)?.image), [cards, figures]);
  const waiting = (cards?.length ?? 0) - usable.length;
  const due = useMemo(() => usable.filter((c) => isDue(c.srs)), [usable]);

  const generate = (count: number, f?: string) =>
    runJob(`cards:${kitId}`, async ({ signal, report }) => {
      report("Writing flashcards");
      await generateFlashcards(kitId, { count, focus: f, signal });
    });

  const findDiagrams = () =>
    runJob(`diagrams:${kitId}`, async ({ signal, report }) => {
      report("Looking for labelled diagrams in your slides");
      setDiagramNote("");
      const res = await makeDiagramCards(kitId, { signal, onProgress: (done, total) => report(`Looking for labelled diagrams: page ${done} of ${total}`) });
      setDiagramNote(
        res.cards
          ? `Made ${res.cards} cards from ${res.figures} diagram${res.figures === 1 ? "" : "s"}.${res.left ? ` ${res.left} more pages to look at.` : ""}`
          : `No labelled diagrams on those ${res.pages} pages.${res.left ? ` ${res.left} more to look at.` : ""}`,
      );
    });

  if (kit === null) return <MissingKit />;

  if (!kit || !cards || !figures) return <Spinner label="Loading" />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Flashcards"
        subtitle={`${kit.title} · ${cards.length} cards · ${due.length} due`}
        back={`/kit/${kitId}`}
        actions={
          <>
            {!!scannable && (
              <Button variant="secondary" size="sm" onClick={() => setDiagrams(true)} loading={!!diagramJob && !diagramJob.done}>
                <Scan className="size-4" /> Diagram cards
              </Button>
            )}
            {cards.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setMore(true)} loading={!!job && !job.done}>
                <Sparkles className="size-4" /> More cards
              </Button>
            )}
          </>
        }
      />
      {job?.error && <ErrorBox error={job.error} onRetry={() => generate(20)} />}
      {diagramJob?.error && <ErrorBox error={diagramJob.error} onRetry={findDiagrams} />}
      {diagramJob && !diagramJob.done && (
        <Card className="mb-4 p-3">
          <Spinner label={diagramJob.status} />
        </Card>
      )}
      {!diagramJob && diagramNote && <Card className="mb-4 p-3 text-sm">{diagramNote}</Card>}
      {waiting > 0 && <p className="mb-3 text-xs text-muted">{waiting} diagram card{waiting === 1 ? " is" : "s are"} waiting for {waiting === 1 ? "its image" : "their images"} to sync to this device.</p>}

      {cards.length === 0 ? (
        job && !job.done ? (
          <Card className="p-8">
            <Spinner label={job.status} />
          </Card>
        ) : (
          <Empty icon={<Layers className="size-8" />} title="No flashcards yet">
            <Button onClick={() => generate(24)} className="mt-2">
              <Sparkles className="size-4" /> Generate flashcards
            </Button>
          </Empty>
        )
      ) : (
        <>
          <div className="mb-4">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "review", label: `Review${due.length ? ` (${due.length})` : ""}` },
                { value: "browse", label: "All cards" },
              ]}
            />
          </div>
          {mode === "review" ? <Review cards={usable} due={due} figures={figures} /> : <Browse cards={cards} kitId={kitId} figures={figures} />}
        </>
      )}

      <Modal open={more} onClose={() => setMore(false)} title="Generate more cards">
        <div className="space-y-4">
          <Field label="Focus (optional)" hint="Leave blank to fill gaps across the whole kit.">
            <input className={inputClass} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. enzyme names and functions" />
          </Field>
          <Button
            className="w-full"
            onClick={() => {
              generate(15, focus.trim() || undefined);
              setMore(false);
            }}
          >
            Generate 15 cards
          </Button>
        </div>
      </Modal>

      <Modal open={diagrams} onClose={() => setDiagrams(false)} title="Diagram cards">
        <div className="space-y-3 text-sm">
          <p>
            Mnemo looks through your slides for labelled diagrams and turns every label into a card: the label is covered, and you name the part.
          </p>
          <p className="text-muted">
            {scannable} page{scannable === 1 ? "" : "s"} to look at{(scannable ?? 0) > PAGES_PER_RUN ? `, ${PAGES_PER_RUN} per run` : ""}. About $0.002 a page. The slides were kept on this device when you added them, so this works for PDFs and photos added here.
          </p>
          <Button
            className="w-full"
            onClick={() => {
              findDiagrams();
              setDiagrams(false);
            }}
          >
            <Scan className="size-4" /> Find diagrams
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Review({ cards, due, figures }: { cards: Flashcard[]; due: Flashcard[]; figures: Map<string, Figure> }) {
  const [queue, setQueue] = useState<string[]>(() => due.map((c) => c.id));
  const [cram, setCram] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const current = queue.length ? byId.get(queue[0]) : undefined;

  // Cards that become due while reviewing (e.g. "Again" in 1 minute) rejoin the queue.
  useEffect(() => {
    if (cram) return;
    const t = setInterval(() => {
      const nowDue = cards.filter((c) => isDue(c.srs) && !queue.includes(c.id)).map((c) => c.id);
      if (nowDue.length) setQueue((q) => [...q, ...nowDue]);
    }, 15000);
    return () => clearInterval(t);
  }, [cards, queue, cram]);

  const rate = async (grade: Grade) => {
    if (!current) return;
    setFlipped(false);
    setDoneCount((n) => n + 1);
    if (cram) {
      setQueue((q) => (grade === Rating.Again ? [...q.slice(1), q[0]] : q.slice(1)));
      return;
    }
    const srs = review(current.srs, grade);
    await db.flashcards.update(current.id, { srs });
    setQueue((q) => (isDue(srs) ? [...q.slice(1), q[0]] : q.slice(1)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
      if (flipped && /^[1-4]$/.test(e.key)) rate(Number(e.key) as Grade);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!current) {
    return (
      <Card className="space-y-4 p-8 text-center">
        <div className="text-4xl">🎉</div>
        <h3 className="font-semibold">{doneCount ? `Done! ${doneCount} reviews.` : "Nothing due right now."}</h3>
        <p className="text-sm text-muted">Spaced repetition brings each card back right before you'd forget it.</p>
        <Button
          variant="secondary"
          onClick={() => {
            setCram(true);
            setQueue(shuffle(cards).map((c) => c.id));
          }}
        >
          <Shuffle className="size-4" /> Practise all cards anyway
        </Button>
        <p className="text-xs text-muted">Practice mode doesn't change your schedule.</p>
      </Card>
    );
  }

  const front = reversed ? current.back : current.front;
  const back = reversed ? current.front : current.back;
  const intervals = preview(current.srs);
  const total = doneCount + queue.length;
  const figure = current.figure && figures.get(current.figure.id);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Progress value={doneCount / Math.max(1, total)} className="flex-1" />
        <span className="text-xs tabular-nums text-muted">{queue.length} left</span>
        <button onClick={() => setReversed((r) => !r)} className={clsx("rounded-lg p-1.5 text-muted hover:text-[var(--text)]", reversed && "text-brand-600")} title="Show the answer side first">
          <RotateCcw className="size-4" />
        </button>
      </div>
      {figure ? (
        // A diagram card isn't flipped: the covered label opens in place.
        <Card className="cursor-pointer select-none space-y-3 p-4 text-center" onClick={() => setFlipped((f) => !f)}>
          <div className="flex items-center justify-between gap-2">
            {cram ? <Badge>practice</Badge> : <span />}
            {current.concept && <Badge>{current.concept}</Badge>}
          </div>
          <FigureView figure={figure} target={current.figure!.label} revealed={flipped} />
          <div className="min-h-12">
            {flipped ? <p className="text-xl font-semibold">{current.back}</p> : <p className="text-sm text-muted">{figure.title}: name the highlighted part. Tap to check.</p>}
          </div>
        </Card>
      ) : (
      <div className={clsx("flip cursor-pointer select-none", flipped && "flipped")} onClick={() => setFlipped((f) => !f)}>
        <div className="flip-inner relative min-h-72">
          <Card className="flip-face absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
            {cram && <Badge className="absolute top-3 left-3">practice</Badge>}
            {current.concept && <Badge className="absolute top-3 right-3">{current.concept}</Badge>}
            <InlineMarkdown className={clsx(current.kind === "term" && !reversed ? "text-2xl font-semibold" : "text-lg")}>{front}</InlineMarkdown>
            <span className="absolute bottom-3 text-xs text-muted">Tap to flip</span>
          </Card>
          <Card className="flip-face flip-back absolute inset-0 flex items-center justify-center bg-brand-50 p-8 text-center dark:bg-brand-950/40">
            <InlineMarkdown className="text-lg">{back}</InlineMarkdown>
          </Card>
        </div>
      </div>
      )}
      <div className={clsx("mt-4 grid grid-cols-4 gap-2 transition", !flipped && "pointer-events-none opacity-30")}>
        {(
          [
            [Rating.Again, "Again", "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"],
            [Rating.Hard, "Hard", "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"],
            [Rating.Good, "Good", "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"],
            [Rating.Easy, "Easy", "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"],
          ] as [Grade, string, string][]
        ).map(([g, label, cls]) => (
          <button key={g} onClick={() => rate(g)} className={clsx("rounded-xl py-2.5 text-sm font-semibold transition active:scale-95", cls)}>
            {label}
            {!cram && <span className="block text-[11px] font-normal opacity-75">{formatInterval(intervals[g])}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Browse({ cards, kitId, figures }: { cards: Flashcard[]; kitId: string; figures: Map<string, Figure> }) {
  const [editing, setEditing] = useState<Flashcard | null>(null);
  const [query, setQuery] = useState("");
  const shown = cards.filter((c) => !query || `${c.front} ${c.back}`.toLowerCase().includes(query.toLowerCase()));

  const save = async () => {
    if (!editing || !editing.front.trim() || !editing.back.trim()) return;
    await db.flashcards.put(editing);
    setEditing(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className={inputClass} placeholder="Search cards" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button
          variant="secondary"
          onClick={() => setEditing({ id: newId(), kitId, front: "", back: "", kind: "term", srs: newCard(), createdAt: Date.now() })}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {shown.map((c) => {
        const figure = c.figure && figures.get(c.figure.id);
        return (
        <Card key={c.id} className="group flex gap-3 p-3">
          {c.figure ? (
            <div className="flex flex-1 items-center gap-3">
              {figure?.image ? <FigureView figure={figure} target={c.figure.label} revealed className="shrink-0 [&_img]:max-h-20 [&_img]:max-w-28" /> : <div className="h-16 w-28 shrink-0 rounded-lg surface-2" />}
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.back}</div>
                <div className="truncate text-xs text-muted">Diagram card · {c.front}</div>
              </div>
            </div>
          ) : (
          <div className="grid flex-1 gap-1 sm:grid-cols-[2fr_3fr] sm:gap-4">
            <InlineMarkdown className="text-sm font-medium">{c.front}</InlineMarkdown>
            <InlineMarkdown className="text-sm text-muted">{c.back}</InlineMarkdown>
          </div>
          )}
          <div className="flex shrink-0 flex-col gap-1">
            {!c.figure && (
            <button onClick={() => setEditing(c)} className="rounded p-1 text-muted hover:text-brand-600" aria-label="Edit">
              <Pencil className="size-4" />
            </button>
            )}
            <button onClick={() => db.flashcards.delete(c.id)} className="rounded p-1 text-muted hover:text-rose-600" aria-label="Delete">
              <Trash className="size-4" />
            </button>
          </div>
        </Card>
        );
      })}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && cards.some((c) => c.id === editing.id) ? "Edit card" : "New card"}>
        {editing && (
          <div className="space-y-4">
            <Field label="Front">
              <textarea className={inputClass} value={editing.front} onChange={(e) => setEditing({ ...editing, front: e.target.value })} />
            </Field>
            <Field label="Back">
              <textarea className={clsx(inputClass, "min-h-24")} value={editing.back} onChange={(e) => setEditing({ ...editing, back: e.target.value })} />
            </Field>
            <Button className="w-full" onClick={save}>
              Save
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
