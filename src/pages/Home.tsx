import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { FolderPlus, KeyRound, LoaderCircle, Plus, Trash } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Card, Empty, inputClass, LinkButton, Modal, PageHeader, Progress } from "../components/ui";
import { db, deleteKit, newId, type Kit } from "../lib/db";
import { daysUntil } from "../lib/plan";
import { cancelKitJobs } from "../lib/jobs";
import { isDue } from "../lib/srs";
import { useSettings } from "../lib/settings";

interface KitStats {
  cards: number;
  due: number;
  mastery: number;
}

export default function Home() {
  const settings = useSettings();
  const [folder, setFolder] = useState<string | "all">("all");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const folders = useLiveQuery(() => db.folders.orderBy("createdAt").toArray());
  const kits = useLiveQuery(() => db.kits.orderBy("updatedAt").reverse().toArray());
  const stats = useLiveQuery(async () => {
    const out = new Map<string, KitStats>();
    const [cards, concepts] = await Promise.all([db.flashcards.toArray(), db.concepts.toArray()]);
    const get = (id: string) => out.get(id) ?? out.set(id, { cards: 0, due: 0, mastery: 0 }).get(id)!;
    for (const c of cards) {
      const s = get(c.kitId);
      s.cards++;
      if (isDue(c.srs)) s.due++;
    }
    const byKit = new Map<string, number[]>();
    for (const c of concepts) byKit.set(c.kitId, [...(byKit.get(c.kitId) ?? []), c.mastery]);
    for (const [id, m] of byKit) get(id).mastery = m.reduce((a, b) => a + b, 0) / m.length;
    return out;
  });

  const shown = (kits ?? []).filter((k) => folder === "all" || k.folderId === folder);

  const createFolder = async () => {
    if (!newFolder?.trim()) return;
    await db.folders.add({ id: newId(), name: newFolder.trim(), createdAt: Date.now() });
    setNewFolder(null);
  };

  const deleteFolder = async (id: string) => {
    if (!confirm("Delete this folder? The kits inside it are kept.")) return;
    await db.kits.where("folderId").equals(id).modify({ folderId: undefined });
    await db.folders.delete(id);
    setFolder("all");
  };

  return (
    <div>
      {!settings.apiKey && (
        <Link
          to="/settings"
          className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <KeyRound className="size-5 shrink-0" />
          <span>
            <b>One-time setup:</b> add a Gemini API key in Settings so Mnemo can build your study kits.
          </span>
        </Link>
      )}

      <PageHeader
        title="Your study kits"
        subtitle="Upload course material and Mnemo builds flashcards, practice questions, guides and podcasts from it."
        actions={
          <LinkButton to="/new">
            <Plus className="size-4" /> New kit
          </LinkButton>
        }
      />

      {(folders?.length ?? 0) > 0 || kits?.length ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {[{ id: "all", name: "All kits" }, ...(folders ?? [])].map((f) => (
            <button
              key={f.id}
              onClick={() => setFolder(f.id)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-sm font-medium transition",
                folder === f.id ? "bg-brand-700 text-white" : "surface text-muted hover:text-[var(--text)]",
              )}
            >
              {f.name}
            </button>
          ))}
          <button onClick={() => setNewFolder("")} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted hover:text-brand-700">
            <FolderPlus className="size-4" /> Folder
          </button>
          {folder !== "all" && (
            <button onClick={() => deleteFolder(folder)} className="ml-auto text-xs text-muted hover:text-rose-600">
              Delete folder
            </button>
          )}
        </div>
      ) : null}

      {kits === undefined ? null : shown.length === 0 ? (
        <Empty icon={<img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-20 rounded-2xl" />} title={kits.length ? "No kits in this folder" : "Create your first study kit"}>
          Drop in lecture slides, a PDF chapter, a recording, a YouTube lecture, or your own notes.
          <div className="mt-4">
            <LinkButton to="/new">
              <Plus className="size-4" /> New kit
            </LinkButton>
          </div>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((kit) => (
            <KitCard key={kit.id} kit={kit} stats={stats?.get(kit.id)} folderName={folders?.find((f) => f.id === kit.folderId)?.name} />
          ))}
        </div>
      )}

      <Modal open={newFolder !== null} onClose={() => setNewFolder(null)} title="New folder">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createFolder();
          }}
          className="space-y-4"
        >
          <input autoFocus className={inputClass} placeholder="e.g. BIO 201" value={newFolder ?? ""} onChange={(e) => setNewFolder(e.target.value)} />
          <Button type="submit" className="w-full">
            Create folder
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function KitCard({ kit, stats, folderName }: { kit: Kit; stats?: KitStats; folderName?: string }) {
  const remove = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm(`Delete "${kit.title}" and everything in it?`)) return;
    cancelKitJobs(kit.id);
    await deleteKit(kit.id);
  };
  return (
    <Link to={`/kit/${kit.id}`} className="group">
      <Card className="flex h-full flex-col p-4 transition group-hover:border-brand-400 group-hover:shadow-md">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex size-11 items-center justify-center rounded-xl surface-2 text-2xl">{kit.emoji}</div>
          <button onClick={remove} className="rounded-lg p-1.5 text-muted transition hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100" aria-label="Delete kit">
            <Trash className="size-4" />
          </button>
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug">{kit.title}</h3>
        {kit.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{kit.description}</p>}
        <div className="mt-auto pt-4">
          {kit.status === "processing" ? (
            <Badge tone="brand">
              <LoaderCircle className="size-3 animate-spin" /> Building…
            </Badge>
          ) : kit.status === "error" ? (
            <Badge tone="rose">Needs attention</Badge>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
                <span>Mastery {Math.round((stats?.mastery ?? 0) * 100)}%</span>
                <span className="flex gap-1.5">
                  {folderName && <Badge>{folderName}</Badge>}
                  {kit.examDate && <ExamBadge examDate={kit.examDate} />}
                  {!!stats?.due && <Badge tone="amber">{stats.due} due</Badge>}
                </span>
              </div>
              <Progress value={stats?.mastery ?? 0} />
            </>
          )}
        </div>
      </Card>
    </Link>
  );
}

function ExamBadge({ examDate }: { examDate: string }) {
  const days = daysUntil(examDate);
  if (days === 0) return <Badge tone="rose">Exam day</Badge>;
  return <Badge tone={days <= 3 ? "amber" : "brand"}>Exam in {days}d</Badge>;
}
