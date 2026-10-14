import { useLiveQuery } from "dexie-react-hooks";
import { Check, Download, ExternalLink, Eye, EyeOff, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Card, ErrorBox, Field, inputClass, PageHeader, Segmented } from "../components/ui";
import { exportAll, importAll } from "../lib/backup";
import { db } from "../lib/db";
import { generateText } from "../lib/gemini";
import { download } from "../lib/hooks";
import { findModel, formatUsd, MODELS, ratesAt } from "../lib/pricing";
import { TTS_VOICES, updateSettings, useSettings, type Settings as S, type ThinkingLevel } from "../lib/settings";
import { monthStart, projectMonth, summarize, taskLabel } from "../lib/usage";
import { Stat } from "./Progress";
import { SyncCard } from "../components/SyncCard";
import { disableSync } from "../lib/sync";

export default function Settings() {
  const s = useSettings();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Stored on this device, and on your other devices if sync is on." />
      <ApiKey />
      <SyncCard />
      <Usage />
      <Models s={s} />
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Appearance</h2>
        <Segmented
          value={s.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>
      <Backup />
    </div>
  );
}

function ApiKey() {
  const { apiKey } = useSettings();
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "testing" | "ok" | string>("idle");

  const test = async () => {
    setState("testing");
    try {
      await generateText({ role: "fast", task: "key-check", contents: "Reply with the single word OK." });
      setState("ok");
    } catch (err) {
      setState((err as Error).message);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Gemini API key</h2>
        <p className="mt-1 text-sm text-muted">
          Get a free key at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 underline dark:text-brand-300">
            aistudio.google.com/apikey <ExternalLink className="size-3" />
          </a>
          . It's kept in this browser and sent only to Google.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type={show ? "text" : "password"}
          className={inputClass}
          placeholder="AIza…"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            updateSettings({ apiKey: e.target.value.trim() });
            setState("idle");
          }}
        />
        <Button variant="secondary" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide key" : "Show key"}>
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button onClick={test} loading={state === "testing"} disabled={!apiKey}>
          {state === "ok" ? <Check className="size-4" /> : null} Test
        </Button>
      </div>
      {state !== "idle" && state !== "testing" && state !== "ok" && <ErrorBox error={state} />}
      {state === "ok" && <p className="text-sm text-emerald-700 dark:text-emerald-300">Key works.</p>}
      <details className="text-sm text-muted">
        <summary className="cursor-pointer font-medium text-[var(--text)]">Free key vs. billing enabled</summary>
        <div className="mt-2 space-y-2">
          <p>
            <b>Free tier:</b> costs nothing but has daily request limits, and Google may use what you send to improve its products. Fine for trying it out.
          </p>
          <p>
            <b>Billing enabled</b> (in Google AI Studio): you pay per use (the numbers below), get much higher limits, and your material isn't used for training. A full semester of heavy use is typically a few dollars a month.
          </p>
          <p>Tip: in Google Cloud Console you can restrict the key to this site's address so it's useless anywhere else.</p>
        </div>
      </details>
    </Card>
  );
}

function Usage() {
  const rows = useLiveQuery(() => db.usage.orderBy("at").reverse().toArray());
  if (!rows) return null;
  const month = rows.filter((r) => r.at >= monthStart());
  const sm = summarize(month);
  const all = summarize(rows);
  const maxTask = Math.max(...sm.byTask.map((t) => t.cost), 0.000001);

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="font-semibold">API spending</h2>
        <p className="mt-1 text-sm text-muted">
          Measured from the token counts Gemini reports on every call, at paid-tier prices. On the free tier, you aren't actually charged.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="This month" value={formatUsd(sm.total)} sub={`${sm.calls} calls`} />
        <Stat label="Month projected" value={formatUsd(projectMonth(sm.total))} sub="at this pace" />
        <Stat label="All time" value={formatUsd(all.total)} sub={`${all.calls} calls`} />
      </div>
      {sm.byTask.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">This month by feature</h3>
          <div className="space-y-1.5">
            {sm.byTask.map((t) => (
              <div key={t.key} className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 text-sm" title={`${t.key}: ${formatUsd(t.cost)} over ${t.calls} calls`}>
                <span className="truncate text-muted">{t.key}</span>
                <div className="h-2 rounded surface-2">
                  <div className="h-full rounded bg-brand-400" style={{ width: `${Math.max(1, (t.cost / maxTask) * 100)}%` }} />
                </div>
                <span className="text-right tabular-nums">{formatUsd(t.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Recent calls</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-2 font-medium">When</th>
                  <th className="py-1 pr-2 font-medium">Feature</th>
                  <th className="py-1 pr-2 font-medium">Model</th>
                  <th className="py-1 pr-2 text-right font-medium">In</th>
                  <th className="py-1 pr-2 text-right font-medium">Out</th>
                  <th className="py-1 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((r) => (
                  <tr key={r.id} className="border-t border-theme">
                    <td className="py-1 pr-2 whitespace-nowrap">{new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="py-1 pr-2">{taskLabel(r.task)}</td>
                    <td className="py-1 pr-2 text-muted">{r.model.replace("gemini-", "")}</td>
                    <td className="py-1 pr-2 text-right tabular-nums" title={`${r.cached.toLocaleString()} cached`}>
                      {(r.input + r.audioInput + r.cached).toLocaleString()}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums" title={`${r.thoughts.toLocaleString()} thinking`}>
                      {(r.output + r.audioOutput + r.thoughts).toLocaleString()}
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatUsd(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}

const THINKING: { value: ThinkingLevel; label: string }[] = [
  { value: "default", label: "Model default" },
  { value: "MINIMAL", label: "Minimal" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

function priceLine(id: string): string {
  const r = ratesAt(id);
  if (!r) return "unknown price";
  return r.audioOutput ? `$${r.input} in · $${r.audioOutput} audio out per 1M` : `$${r.input} in · $${r.output} out per 1M`;
}

function Models({ s }: { s: S }) {
  const text = MODELS.filter((m) => m.kind === "text");
  const tts = MODELS.filter((m) => m.kind === "tts");
  const select = (key: "smartModel" | "fastModel" | "ttsModel", list: typeof MODELS) => (
    <select className={inputClass} value={s[key]} onChange={(e) => updateSettings({ [key]: e.target.value })}>
      {list.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} ({priceLine(m.id)})
        </option>
      ))}
      {!list.some((m) => m.id === s[key]) && <option value={s[key]}>{s[key]}</option>}
    </select>
  );
  const thinking = (key: "smartThinking" | "fastThinking") => (
    <select className={inputClass} value={s[key]} onChange={(e) => updateSettings({ [key]: e.target.value as ThinkingLevel })}>
      {THINKING.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="font-semibold">Models</h2>
        <p className="mt-1 text-sm text-muted">The defaults are the best balance of quality and cost. Thinking tokens are billed as output, so more thinking means slower and pricier.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label="Study content" hint={findModel(s.smartModel)?.note ?? "Concepts, flashcards, questions, guides, podcast scripts, tutor."}>
          {select("smartModel", text)}
        </Field>
        <Field label="Thinking">{thinking("smartThinking")}</Field>
        <Field label="Bulk work" hint={findModel(s.fastModel)?.note ?? "Transcribing audio/video, reading web pages, grading short answers."}>
          {select("fastModel", text)}
        </Field>
        <Field label="Thinking">{thinking("fastThinking")}</Field>
        <Field label="Podcast voice model" hint={findModel(s.ttsModel)?.note}>
          {select("ttsModel", tts)}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Field key={i} label={i === 0 ? "Podcast host 1 voice" : "Podcast host 2 voice"}>
            <select
              className={inputClass}
              value={s.podcastVoices[i]}
              onChange={(e) => {
                const v = [...s.podcastVoices] as [string, string];
                v[i] = e.target.value;
                updateSettings({ podcastVoices: v });
              }}
            >
              {TTS_VOICES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        ))}
      </div>
    </Card>
  );
}

function Backup() {
  const file = useRef<HTMLInputElement>(null);
  const [audio, setAudio] = useState(false);
  const [msg, setMsg] = useState("");

  const doExport = async () => {
    const blob = await exportAll(audio);
    download(blob, `mnemo-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = await importAll(f);
      setMsg(`Imported ${n.toLocaleString()} records.`);
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const wipe = async () => {
    if (!confirm("Delete ALL kits, progress and usage history from this device? Synced devices keep their copy, and sync is turned off here.")) return;
    disableSync();
    await db.delete();
    location.reload();
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Backup and devices</h2>
        <p className="mt-1 text-sm text-muted">Your kits live in this browser. Export a backup to keep them safe or to move them to another device, then import it there.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-brand-700" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
        Include podcast audio (much larger file)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={doExport}>
          <Download className="size-4" /> Export backup
        </Button>
        <Button variant="secondary" onClick={() => file.current?.click()}>
          <Upload className="size-4" /> Import backup
        </Button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => doImport(e.target.files?.[0])} />
        <Button variant="ghost" className="ml-auto text-rose-600" onClick={wipe}>
          Delete all data
        </Button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
    </Card>
  );
}
