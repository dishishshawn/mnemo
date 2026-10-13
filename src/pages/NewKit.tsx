import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { LanguageSelect } from "../components/LanguageSelect";
import { SourcePicker } from "../components/SourcePicker";
import { Button, Card, ErrorBox, Field, inputClass, PageHeader } from "../components/ui";
import { db } from "../lib/db";
import { runJob } from "../lib/jobs";
import { useSettings } from "../lib/settings";
import { addSources, createKit, generateFlashcards, type NewSource } from "../lib/study";

export default function NewKit() {
  const navigate = useNavigate();
  const settings = useSettings();
  const folders = useLiveQuery(() => db.folders.toArray());
  const [items, setItems] = useState<NewSource[]>([]);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("auto");
  const [folderId, setFolderId] = useState("");
  const [deepRead, setDeepRead] = useState(false);
  const [error, setError] = useState("");
  const hasPdf = items.some((i) => i.type === "file" && i.file.name.toLowerCase().endsWith(".pdf"));

  const create = async () => {
    if (!settings.apiKey) return setError("Add your Gemini API key in Settings first.");
    if (!items.length) return setError("Add at least one file, link, or some notes.");
    const kitId = await createKit({ title, language, folderId: folderId || undefined });
    const sources = items.map((i) => (i.type === "file" ? { ...i, deepRead } : i));
    runJob(`kit:${kitId}`, async ({ signal, report }) => {
      await addSources(kitId, sources, (name, status) => report(`${status}${name === "kit" ? "" : `: ${name}`}`), signal);
      if ((await db.kits.get(kitId))?.status !== "ready") return;
      report("Writing flashcards");
      await generateFlashcards(kitId, { signal });
    });
    navigate(`/kit/${kitId}`);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New study kit" subtitle="Add everything for one topic, lecture or exam. You can add more later." back="/" />
      <Card className="space-y-6 p-5">
        <SourcePicker items={items} onChange={setItems} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" hint="Leave blank and Mnemo will name it.">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cell respiration" />
          </Field>
          <Field label="Study in">
            <LanguageSelect value={language} onChange={setLanguage} />
          </Field>
          {!!folders?.length && (
            <Field label="Folder">
              <select className={inputClass} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">None</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {hasPdf && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-brand-700" checked={deepRead} onChange={(e) => setDeepRead(e.target.checked)} />
            <span>
              <b>Read PDFs with AI</b>
              <span className="block text-muted">
                Better for diagram-heavy slides and handwriting. Scanned PDFs always use AI. Costs about $0.01–0.05 per PDF; text PDFs are otherwise read for free.
              </span>
            </span>
          </label>
        )}

        {error && <ErrorBox error={error} />}
        <Button size="lg" className="w-full" onClick={create} disabled={!items.length}>
          <Sparkles className="size-4" /> Build study kit
        </Button>
      </Card>
    </div>
  );
}
