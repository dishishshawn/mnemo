import clsx from "clsx";
import { FileText, Globe, Image, Link2, Music, Presentation, Upload, Video, X, MonitorPlay } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { kindOf, youtubeId } from "../lib/extract";
import type { SourceKind } from "../lib/db";
import type { NewSource } from "../lib/study";
import { inputClass } from "./ui";

export const KIND_ICON: Record<SourceKind, ReactNode> = {
  pdf: <FileText className="size-4" />,
  docx: <FileText className="size-4" />,
  pptx: <Presentation className="size-4" />,
  image: <Image className="size-4" />,
  audio: <Music className="size-4" />,
  video: <Video className="size-4" />,
  youtube: <MonitorPlay className="size-4" />,
  web: <Globe className="size-4" />,
  text: <FileText className="size-4" />,
};

const ACCEPT =
  ".pdf,.docx,.pptx,.txt,.md,.csv,.html,.htm,.rtf,.tex,.json,.ipynb,.srt,.vtt,image/*,audio/*,video/*,.m4a,.heic,.mkv,.mov";

function label(s: NewSource): string {
  return s.type === "file" ? s.file.name : s.type === "text" ? s.name : s.url;
}

function kindOfSource(s: NewSource): SourceKind {
  return s.type === "file" ? kindOf(s.file) : s.type === "text" ? "text" : s.type;
}

export function SourcePicker({ items, onChange }: { items: NewSource[]; onChange: (items: NewSource[]) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"files" | "link" | "notes">("files");

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    onChange([...items, ...Array.from(files).map((file) => ({ type: "file" as const, file }))]);
  };

  const addUrl = () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return;
    onChange([...items, youtubeId(u) ? { type: "youtube", url: u } : { type: "web", url: u }]);
    setUrl("");
  };

  const addNotes = () => {
    if (!notes.trim()) return;
    const firstLine = notes.trim().split("\n")[0].slice(0, 50);
    onChange([...items, { type: "text", name: firstLine || "Pasted notes", text: notes }]);
    setNotes("");
  };

  const tabs = [
    { id: "files" as const, label: "Files", icon: <Upload className="size-4" /> },
    { id: "link" as const, label: "YouTube / web link", icon: <Link2 className="size-4" /> },
    { id: "notes" as const, label: "Paste notes", icon: <FileText className="size-4" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
              tab === t.id ? "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200" : "text-muted hover:text-[var(--text)]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "files" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className={clsx(
            "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
            dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-theme hover:border-brand-400",
          )}
        >
          <Upload className="size-8 text-brand-600" />
          <div className="font-medium">Drop files here or tap to choose</div>
          <div className="text-xs text-muted">PDF, slides (PPTX), Word, photos of notes, audio, video, text and more</div>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </div>
      )}

      {tab === "link" && (
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="https://youtube.com/watch?v=… or any article URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUrl())}
          />
          <button type="button" onClick={addUrl} className="rounded-xl bg-brand-700 px-4 text-sm font-medium text-white">
            Add
          </button>
        </div>
      )}

      {tab === "notes" && (
        <div className="space-y-2">
          <textarea
            className={clsx(inputClass, "min-h-40 font-mono text-xs")}
            placeholder="Paste lecture notes, a textbook passage, a syllabus…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button type="button" onClick={addNotes} className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-medium text-white">
            Add notes
          </button>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((s, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl surface-2 px-3 py-2 text-sm">
              <span className="text-brand-700 dark:text-brand-300">{KIND_ICON[kindOfSource(s)]}</span>
              <span className="min-w-0 flex-1 truncate">{label(s)}</span>
              {s.type === "file" && <span className="text-xs text-muted">{(s.file.size / 1024 / 1024).toFixed(1)} MB</span>}
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-muted hover:text-rose-600" aria-label="Remove">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
