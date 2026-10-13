import { useLiveQuery } from "dexie-react-hooks";
import { Download, Headphones, Trash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Empty, ErrorBox, Field, inputClass, PageHeader, Progress, Spinner, MissingKit } from "../components/ui";
import { db, type Output } from "../lib/db";
import { download, slug, useKit } from "../lib/hooks";
import { cancelJob, runJob, useJob } from "../lib/jobs";
import type { PodcastScript } from "../lib/prompts";
import { updateSettings, useSettings } from "../lib/settings";
import { generatePodcast, HOSTS, recordPodcastHere } from "../lib/study";
import { findModel, ratesAt } from "../lib/pricing";

export default function Podcast() {
  const { kitId, kit } = useKit();
  const settings = useSettings();
  const episodes = useLiveQuery(() => db.outputs.where("[kitId+type]").equals([kitId, "podcast"]).reverse().sortBy("createdAt"), [kitId]);
  const job = useJob(`podcast:${kitId}`);
  const [focus, setFocus] = useState("");
  const busy = !!job && !job.done;

  // 25 audio tokens per second of speech; the script itself costs a few cents on top.
  const tts = ratesAt(settings.ttsModel);
  const estimate = tts ? (settings.podcastMinutes * 60 * 25 * (tts.audioOutput ?? tts.output)) / 1e6 + 0.02 : undefined;

  const generate = () =>
    runJob(`podcast:${kitId}`, async ({ signal, report }) => {
      await generatePodcast(kitId, {
        focus: focus.trim() || undefined,
        signal,
        onProgress: (done, total, stage) => report(stage === "Recording audio" ? `Recording audio (${done}/${total})` : stage, total ? done / total : 0),
      });
    });

  if (kit === null) return <MissingKit />;

  if (!kit || !episodes) return <Spinner label="Loading" />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Podcast" subtitle={kit.title} back={`/kit/${kitId}`} />

      <Card className="mb-6 space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Length">
            <select className={inputClass} value={settings.podcastMinutes} onChange={(e) => updateSettings({ podcastMinutes: Number(e.target.value) })}>
              {[3, 5, 8, 12, 15, 20].map((m) => (
                <option key={m} value={m}>
                  ~{m} minutes
                </option>
              ))}
            </select>
          </Field>
          <Field label="Focus (optional)">
            <input className={inputClass} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. the Krebs cycle" />
          </Field>
        </div>
        {busy ? (
          <div className="space-y-2">
            <Spinner label={job.status} />
            <Progress value={job.progress ?? 0} />
            <Button variant="ghost" size="sm" onClick={() => cancelJob(`podcast:${kitId}`)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button className="w-full" onClick={generate}>
            <Headphones className="size-4" /> Make an episode {estimate !== undefined && <span className="opacity-75">(~${estimate.toFixed(2)})</span>}
          </Button>
        )}
        {job?.error && <ErrorBox error={job.error} onRetry={generate} />}
        <p className="text-xs text-muted">
          Hosts {HOSTS[0]} ({settings.podcastVoices[0]}) and {HOSTS[1]} ({settings.podcastVoices[1]}) using {findModel(settings.ttsModel)?.label ?? settings.ttsModel}. Change voices in Settings.
        </p>
      </Card>

      {episodes.length === 0 && !busy ? (
        <Empty icon={<Headphones className="size-8" />} title="No episodes yet">
          Two hosts walk through your material in a conversation, ending with a quick quiz. Great for commutes and the gym.
        </Empty>
      ) : (
        <div className="space-y-4">
          {episodes.map((ep) => (
            <Episode key={ep.id} episode={ep} kitTitle={kit.title} />
          ))}
        </div>
      )}
    </div>
  );
}

function Episode({ episode, kitTitle }: { episode: Output; kitTitle: string }) {
  const [showScript, setShowScript] = useState(false);
  const url = useMemo(() => (episode.audio ? URL.createObjectURL(episode.audio) : undefined), [episode.audio]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const script = useMemo(() => JSON.parse(episode.content) as PodcastScript, [episode.content]);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{script.title}</h3>
          <div className="mt-0.5 flex gap-2 text-xs text-muted">
            <span>{new Date(episode.createdAt).toLocaleDateString()}</span>
            {!!episode.durationSec && <Badge>{Math.floor(episode.durationSec / 60)}:{String(episode.durationSec % 60).padStart(2, "0")}</Badge>}
          </div>
        </div>
        <div className="flex gap-1">
          {episode.audio && (
            <button onClick={() => download(episode.audio!, `${slug(kitTitle)}-podcast.wav`)} className="rounded-lg p-2 text-muted hover:text-brand-700" aria-label="Download">
              <Download className="size-4" />
            </button>
          )}
          <button onClick={() => confirm("Delete this episode?") && db.outputs.delete(episode.id)} className="rounded-lg p-2 text-muted hover:text-rose-600" aria-label="Delete">
            <Trash className="size-4" />
          </button>
        </div>
      </div>
      {url ? <audio controls src={url} className="w-full" preload="metadata" /> : <RecordHere episodeId={episode.id} />}
      <button onClick={() => setShowScript((s) => !s)} className="text-sm text-brand-700 hover:underline dark:text-brand-300">
        {showScript ? "Hide transcript" : "Show transcript"}
      </button>
      {showScript && (
        <div className="max-h-96 space-y-2 overflow-y-auto rounded-xl surface-2 p-3 text-sm">
          {script.lines.map((l, i) => (
            <p key={i}>
              <b className={l.speaker === "A" ? "text-brand-700 dark:text-brand-300" : "text-amber-700 dark:text-amber-300"}>{l.speaker === "A" ? HOSTS[0] : HOSTS[1]}:</b> {l.text}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Shown for episodes synced from another device: audio is too big to sync, so voice it here. */
function RecordHere({ episodeId }: { episodeId: string }) {
  const job = useJob(`record:${episodeId}`);
  const busy = !!job && !job.done;
  const record = () =>
    runJob(`record:${episodeId}`, async ({ signal, report }) => {
      await recordPodcastHere(episodeId, { signal, onProgress: (d, t) => report(`Recording audio (${d}/${t})`, t ? d / t : 0) });
    });
  return (
    <div className="space-y-2 rounded-xl surface-2 p-3 text-sm">
      <p className="text-muted">The audio for this episode is on the device that made it.</p>
      {busy ? (
        <>
          <Spinner label={job.status} />
          <Progress value={job.progress ?? 0} />
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={record}>
          Record it on this device (~$0.08)
        </Button>
      )}
      {job?.error && <ErrorBox error={job.error} onRetry={record} />}
    </div>
  );
}
