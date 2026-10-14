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
import { addSources, createKit, firstFlashcards, type NewSource } from "../lib/study";
import type { PdfMode } from "../lib/ingest";

export default function NewKit() {
  const navigate = useNavigate();
  const settings = useSettings();
  const folders = useLiveQuery(() => db.folders.toArray());
  const [items, setItems] = useState<NewSource[]>([]);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("auto");
  const [folderId, setFolderId] = useState("");
  const [pdfMode, setPdfMode] = useState<PdfMode>("auto");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const hasPdf = items.some((i) => i.type === "file" && i.file.name.toLowerCase().endsWith(".pdf"));

  const create = async () => {
    if (!settings.apiKey) return setError("Add your Gemini API key in Settings first.");
    if (!items.length) return setError("Add at least one file, link, or some notes.");
    if (creating) return;
    setCreating(true);
    const kitId = await createKit({ title, language, folderId: folderId || undefined });
    const sources = items.map((i) => (i.type === "file" ? { ...i, pdfMode } : i));
    runJob(`kit:${kitId}`, async ({ signal, report }) => {
      const onStatus = (name: string, status: string) => report(`${status}${name === "kit" ? "" : `: ${name}`}`);
      await addSources(kitId, sources, onStatus, signal);
      await firstFlashcards(kitId, onStatus, signal);
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
          <Field label="Reading PDFs" hint="Slides keep a lot in their figures; Gemini reads them for about $0.002 a page. Long text-heavy PDFs (textbook chapters) are read for free on this device unless you choose “Always”.">
            <select className={inputClass} value={pdfMode} onChange={(e) => setPdfMode(e.target.value as PdfMode)}>
              <option value="auto">Automatic: Gemini for slides and short PDFs (recommended)</option>
              <option value="ai">Always with Gemini, figures included</option>
              <option value="local">Text only, free (skips figures)</option>
            </select>
          </Field>
        )}

        {error && <ErrorBox error={error} />}
        <Button size="lg" className="w-full" onClick={create} disabled={!items.length} loading={creating}>
          <Sparkles className="size-4" /> Build study kit
        </Button>
      </Card>
    </div>
  );
}
