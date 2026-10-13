import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ChartColumn,
  Brain,
  ClipboardCheck,
  FileStack,
  FileText,
  Gamepad2,
  Headphones,
  Layers,
  MessageCircle,
  ScrollText,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { LanguageSelect } from "../components/LanguageSelect";
import { Badge, Card, ErrorBox, inputClass, LinkButton, Progress, Spinner } from "../components/ui";
import { db } from "../lib/db";
import { overallMastery, useConcepts, useKit } from "../lib/hooks";
import { useJob } from "../lib/jobs";
import { isDue } from "../lib/srs";

export default function KitPage() {
  const { kitId, kit } = useKit();
  const concepts = useConcepts(kitId);
  const job = useJob(`kit:${kitId}`);
  const [editing, setEditing] = useState(false);
  const counts = useLiveQuery(async () => {
    const [cards, sources, outputs, tests] = await Promise.all([
      db.flashcards.where("kitId").equals(kitId).toArray(),
      db.sources.where("kitId").equals(kitId).toArray(),
      db.outputs.where("kitId").equals(kitId).toArray(),
      db.tests.where("kitId").equals(kitId).toArray(),
    ]);
    const lastTest = tests.filter((t) => t.finishedAt).sort((a, b) => b.startedAt - a.startedAt)[0];
    return {
      cards: cards.length,
      due: cards.filter((c) => isDue(c.srs)).length,
      sources,
      guide: outputs.some((o) => o.type === "guide"),
      summary: outputs.some((o) => o.type === "summary"),
      podcast: outputs.some((o) => o.type === "podcast"),
      lastTest: lastTest?.score,
    };
  }, [kitId]);
  const folders = useLiveQuery(() => db.folders.toArray());

  if (kit === undefined) return <Spinner label="Loading" />;
  if (kit === null)
    return (
      <div className="space-y-4">
        <p>This kit doesn't exist (it may have been deleted).</p>
        <LinkButton to="/">Back to kits</LinkButton>
      </div>
    );

  const building = kit.status === "processing";
  const mastery = overallMastery(concepts ?? []);
  const base = `/kit/${kitId}`;

  return (
    <div>
      <div className="mb-6 flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl surface text-3xl">{kit.emoji}</div>
        <div className="min-w-0 flex-1">
          <Link to="/" className="text-sm text-muted hover:text-brand-700">
            ← All kits
          </Link>
          {editing ? (
            <input
              autoFocus
              className={clsx(inputClass, "mt-1 text-xl font-bold")}
              defaultValue={kit.title}
              onBlur={(e) => {
                db.kits.update(kitId, { title: e.target.value.trim() || kit.title });
                setEditing(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight" onClick={() => setEditing(true)} title="Click to rename">
              {kit.title}
            </h1>
          )}
          {kit.description && <p className="mt-1 text-sm text-muted">{kit.description}</p>}
        </div>
      </div>

      {building && (
        <Card className="mb-6 space-y-3 p-5">
          <Spinner label={job?.status ?? "Building your kit…"} />
          <ul className="space-y-1 text-sm">
            {counts?.sources.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <Badge tone={s.status === "ready" ? "green" : s.status === "error" ? "rose" : "brand"}>{s.status}</Badge>
                <span className="truncate">{s.name}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Keep this tab open while it works. Long videos can take a few minutes.</p>
        </Card>
      )}
      {!building && job?.status && !job.done && (
        <Card className="mb-6 p-4">
          <Spinner label={job.status} />
        </Card>
      )}
      {kit.status === "error" && (
        <div className="mb-6">
          <ErrorBox error={kit.error ?? "Something went wrong building this kit."} />
          <LinkButton to={`${base}/sources`} variant="secondary" className="mt-3">
            Check sources
          </LinkButton>
        </div>
      )}
      {job?.error && <div className="mb-6"><ErrorBox error={job.error} /></div>}

      {!building && kit.status === "ready" && (
        <>
          <Card className="mb-6 p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Overall mastery</span>
              <span className="text-sm tabular-nums text-muted">{Math.round(mastery * 100)}%</span>
            </div>
            <Progress value={mastery} />
            <p className="mt-2 text-xs text-muted">
              {concepts?.length ?? 0} concepts · {counts?.cards ?? 0} flashcards · {counts?.sources.length ?? 0} source{counts?.sources.length === 1 ? "" : "s"}
            </p>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Tile to={`${base}/smart`} icon={<Brain />} title="Smart Study" accent>
              Adaptive questions that target your weak spots and get harder as you improve.
            </Tile>
            <Tile to={`${base}/cards`} icon={<Layers />} title="Flashcards" badge={counts?.due ? <Badge tone="amber">{counts.due} due</Badge> : undefined}>
              {counts?.cards ? `${counts.cards} cards with spaced repetition.` : "Generate a deck from your material."}
            </Tile>
            <Tile to={`${base}/test`} icon={<ClipboardCheck />} title="Practice test" badge={counts?.lastTest !== undefined ? <Badge>{Math.round(counts.lastTest * 100)}%</Badge> : undefined}>
              Exam-style questions, graded at the end.
            </Tile>
            <Tile to={`${base}/guide`} icon={<ScrollText />} title="Study guide" badge={counts?.guide ? <Badge tone="green">Ready</Badge> : undefined}>
              A full guide with key terms, examples and a self-check.
            </Tile>
            <Tile to={`${base}/summary`} icon={<FileText />} title="Summary" badge={counts?.summary ? <Badge tone="green">Ready</Badge> : undefined}>
              The essentials on one page.
            </Tile>
            <Tile to={`${base}/podcast`} icon={<Headphones />} title="Podcast" badge={counts?.podcast ? <Badge tone="green">Ready</Badge> : undefined}>
              Two hosts talk through your material. Listen on the go.
            </Tile>
            <Tile to={`${base}/games`} icon={<Gamepad2 />} title="Games">
              Match, Term Builder and Stacker, built from your flashcards.
            </Tile>
            <Tile to={`${base}/tutor`} icon={<MessageCircle />} title="Tutor">
              Ask questions. It guides you to the answer instead of giving it away.
            </Tile>
            <Tile to={`${base}/progress`} icon={<ChartColumn />} title="Progress">
              Mastery per concept and your history.
            </Tile>
          </div>
        </>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link to={`${base}/sources`}>
          <Card className="flex items-center gap-3 p-4 hover:border-brand-400">
            <FileStack className="size-5 text-brand-600" />
            <div className="flex-1">
              <div className="text-sm font-medium">Sources</div>
              <div className="text-xs text-muted">View extracted text, add more material</div>
            </div>
            <Badge>{counts?.sources.length ?? 0}</Badge>
          </Card>
        </Link>
        <Card className="grid gap-3 p-4 min-[420px]:grid-cols-2">
          <label className="text-xs text-muted">
            Study in
            <LanguageSelect value={kit.language} onChange={(language) => db.kits.update(kitId, { language })} />
          </label>
          <label className="text-xs text-muted">
            Folder
            <select className={inputClass} value={kit.folderId ?? ""} onChange={(e) => db.kits.update(kitId, { folderId: e.target.value || undefined })}>
              <option value="">None</option>
              {folders?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </Card>
      </div>
    </div>
  );
}

function Tile({ to, icon, title, badge, accent, children }: { to: string; icon: ReactNode; title: string; badge?: ReactNode; accent?: boolean; children: ReactNode }) {
  return (
    <Link to={to} className="group">
      <Card
        className={clsx(
          // A compact row on phones, a tile from sm up.
          "flex h-full items-center gap-3 p-3 transition group-hover:-translate-y-0.5 group-hover:shadow-md sm:flex-col sm:items-stretch sm:gap-2 sm:p-4",
          accent ? "border-brand-300 bg-linear-to-br from-brand-50 to-[var(--surface)] dark:border-brand-800 dark:from-brand-950/60" : "group-hover:border-brand-400",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200 [&>svg]:size-5">{icon}</div>
          <span className="hidden sm:block">{badge}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{title}</h3>
            <span className="sm:hidden">{badge}</span>
          </div>
          <p className="text-sm text-muted">{children}</p>
        </div>
      </Card>
    </Link>
  );
}
