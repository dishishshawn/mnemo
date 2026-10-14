// Explain it back: the student teaches one concept out loud, from memory, and the material is
// used to say which essential points were covered, missed, or wrong. Dictation is the browser's
// own (Web Speech API where it exists; the keyboard mic key everywhere else), so it costs nothing.
import clsx from "clsx";
import { AlertTriangle, Check, Mic, MicOff, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { InlineMarkdown } from "../components/Markdown";
import { PenguinSays, type Mood } from "../components/Penguin";
import { Badge, Button, Card, ErrorBox, inputClass, PageHeader, Spinner, MissingKit } from "../components/ui";
import { db, newId, type Concept } from "../lib/db";
import { useConcepts, useKit } from "../lib/hooks";
import type { ExplainResult } from "../lib/prompts";
import { applyAnswer, levelOf, pickTargets } from "../lib/smart";
import { assessExplanation } from "../lib/study";

/** Aim for an explanation about this long; shorter tends to skip points, longer rambles. */
const TARGET_SECONDS = 75;

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** iPhones and iPads: the keyboard's mic key dictates into any text box, which is the reliable path there. */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function Explain() {
  const { kitId, kit } = useKit();
  const concepts = useConcepts(kitId);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExplainResult | null>(null);
  const rec = useRef<Recognition | null>(null);
  const done = useRef<string[]>([]);
  const canListen = !!recognitionCtor() && !isIOS;

  // Default to the concept Smart Study would pick next: due, weak, or not yet seen.
  useEffect(() => {
    if (concepts?.length && !concept) setConcept(pickTargets(concepts, 1)[0] ?? concepts[0]);
  }, [concepts, concept]);

  useEffect(() => {
    if (startedAt === null || result) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt, result]);

  const stop = useCallback(() => {
    rec.current?.stop();
    rec.current = null;
    setListening(false);
    setInterim("");
  }, []);

  useEffect(() => () => rec.current?.abort(), []);

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setMicError("");
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    done.current = [];
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) done.current.push(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
      if (done.current.length) {
        const spoken = done.current.join(" ");
        done.current = [];
        setText((t) => (t.trim() ? `${t.trim()} ${spoken}` : spoken));
      }
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setMicError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "The browser blocked the microphone. Allow it in the address bar, or use your keyboard's dictation instead."
          : `Dictation stopped (${e.error}). You can keep typing, or use your keyboard's dictation.`,
      );
      stop();
    };
    r.onend = () => {
      // Browsers end recognition on their own after a pause; keep going until the student stops.
      if (rec.current === r) {
        try {
          r.start();
        } catch {
          setListening(false);
        }
      }
    };
    rec.current = r;
    r.start();
    setListening(true);
    if (startedAt === null) setStartedAt(Date.now());
  };

  const reset = (next: Concept | null) => {
    stop();
    setConcept(next);
    setText("");
    setResult(null);
    setError("");
    setMicError("");
    setStartedAt(null);
    setElapsed(0);
  };

  const submit = async () => {
    if (!concept || !text.trim() || loading) return;
    stop();
    setLoading(true);
    setError("");
    try {
      const res = await assessExplanation(kitId, concept, text.trim());
      setResult(res);
      const fresh = await db.concepts.get(concept.id);
      await db.transaction("rw", db.concepts, db.attempts, db.kits, async () => {
        if (fresh) await db.concepts.put(applyAnswer(fresh, res.score, false));
        await db.attempts.add({
          id: newId(),
          kitId,
          questionId: `explain:${concept.id}`,
          concept: concept.name,
          mode: "explain",
          response: text.trim(),
          score: res.score,
          usedHint: false,
          feedback: [res.tip, ...res.missing.map((m) => `Missing: ${m}`), ...res.errors.map((e) => `Error: ${e}`)].join("\n"),
          at: Date.now(),
        });
        await db.kits.update(kitId, { lastStudiedAt: Date.now() });
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const nextConcept = () => {
    if (!concepts) return;
    const others = concepts.filter((c) => c.id !== concept?.id);
    reset(pickTargets(others, 1)[0] ?? others[0] ?? concept);
  };

  if (kit === null) return <MissingKit />;
  if (!kit || !concepts) return <Spinner label="Loading" />;
  if (!concepts.length)
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Explain it back" subtitle={kit.title} back={`/kit/${kitId}`} />
        <Card className="p-6 text-sm text-muted">This kit has no concepts yet. Build the kit first.</Card>
      </div>
    );

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Explain it back" subtitle={kit.title} back={`/kit/${kitId}`} />

      <Card className="mb-4 p-4">
        <div className="mb-2 text-sm font-medium">Pick a concept</div>
        <div className="flex flex-wrap gap-1.5">
          {concepts.map((c) => (
            <button
              key={c.id}
              onClick={() => c.id !== concept?.id && reset(c)}
              className={clsx(
                "rounded-full px-2.5 py-1 text-xs font-medium transition",
                c.id === concept?.id ? "bg-brand-300 text-brand-900 dark:bg-brand-500 dark:text-white" : "surface-2 text-muted hover:text-[var(--text)]",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </Card>

      {concept &&
        (() => {
          const mood: Mood = loading ? "reading" : result ? (result.score >= 0.8 ? "cheer" : result.score >= 0.4 ? "idea" : "oops") : listening ? "listening" : text.trim() ? "thinking" : "idle";
          const line = loading
            ? "Checking against your notes…"
            : result
              ? result.score >= 0.8
                ? "You could teach this!"
                : result.score >= 0.4
                  ? "Good start. A couple of gaps."
                  : "Let's go over it together."
              : listening
                ? "I'm listening…"
                : text.trim()
                  ? "Keep going, I'm following."
                  : `Teach me about ${concept.name}.`;
          return (
            <PenguinSays mood={mood} className="mb-4">
              {line}
            </PenguinSays>
          );
        })()}

      {concept && (
        <Card className="animate-pop p-5" key={concept.id}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="brand">{concept.name}</Badge>
            <Badge>{levelOf(concept)}</Badge>
            {startedAt !== null && (
              <Badge tone={elapsed > TARGET_SECONDS * 2 ? "amber" : "neutral"} className="ml-auto tabular-nums">
                {mm}:{ss}
              </Badge>
            )}
          </div>
          <p className="mb-1 text-lg font-medium leading-relaxed">
            Explain <b>{concept.name}</b> as if you were teaching it to a friend who missed the lecture.
          </p>
          <p className="mb-4 text-sm text-muted">
            Out loud, from memory, about a minute. What is it, why does it matter, how does it work, and what's a common mix-up?
          </p>

          {!result && (
            <div className="space-y-3">
              <div className="relative">
                <textarea
                  className={clsx(inputClass, "min-h-40 pb-7")}
                  placeholder={isIOS ? "Tap here, then press the mic key on your keyboard and start talking…" : canListen ? "Press the mic and start talking, or type…" : "Type your explanation, or use your keyboard's dictation…"}
                  value={interim ? `${text}${text ? " " : ""}${interim}` : text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (startedAt === null && e.target.value.trim()) setStartedAt(Date.now());
                  }}
                  onFocus={() => {
                    if (startedAt === null && isIOS) setStartedAt(Date.now());
                  }}
                />
                <span className="pointer-events-none absolute bottom-2 right-3 text-xs tabular-nums text-muted">{words} words</span>
              </div>
              {micError && (
                <p className="flex gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <MicOff className="size-4 shrink-0" /> {micError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {canListen &&
                  (listening ? (
                    <Button variant="secondary" onClick={stop}>
                      <Square className="size-4 fill-current text-rose-600" /> Stop listening
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={start}>
                      <Mic className="size-4" /> {text ? "Keep talking" : "Start talking"}
                    </Button>
                  ))}
                <Button onClick={submit} loading={loading} disabled={words < 5} className="flex-1">
                  <Sparkles className="size-4" /> Check my explanation
                </Button>
              </div>
              {listening && (
                <p className="flex items-center gap-2 text-xs text-muted">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
                  </span>
                  Listening. Pauses are fine; press stop when you've said it all.
                </p>
              )}
            </div>
          )}

          {error && <div className="mt-4"><ErrorBox error={error} onRetry={submit} /></div>}

          {result && (
            <div className="mt-2 space-y-4">
              <div
                className={clsx(
                  "flex items-center justify-between rounded-xl p-3 text-sm font-medium",
                  result.score >= 0.8
                    ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                    : result.score >= 0.4
                      ? "bg-butter-100 text-butter-800 dark:bg-butter-800/30 dark:text-butter-200"
                      : "bg-blush-100 text-blush-700 dark:bg-blush-700/25 dark:text-blush-200",
                )}
              >
                <span>{result.score >= 0.8 ? "You could teach this." : result.score >= 0.4 ? "Most of the way there." : "The core idea needs another pass."}</span>
                <span className="tabular-nums">
                  {Math.round(result.score * 100)}% · {words} words · {mm}:{ss}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Points title="You covered" items={result.covered} icon={<Check className="size-4 text-emerald-600" />} />
                <Points title="You skipped" items={result.missing} icon={<span className="mt-0.5 inline-block size-4 text-center text-xs font-bold text-amber-600">?</span>} empty="Nothing essential." />
              </div>
              {result.errors.length > 0 && (
                <Points title="Not quite right" items={result.errors} icon={<AlertTriangle className="size-4 text-rose-600" />} />
              )}
              <div className="rounded-xl surface-2 p-3 text-sm">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Next time</div>
                <InlineMarkdown>{result.tip}</InlineMarkdown>
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted hover:text-[var(--text)]">What you said</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted">{text}</p>
              </details>

              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => reset(concept)} className="flex-1">
                  Explain it again
                </Button>
                <Button onClick={nextConcept} className="flex-1">
                  Next concept
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Points({ title, items, icon, empty }: { title: string; items: string[]; icon: React.ReactNode; empty?: string }) {
  return (
    <div className="rounded-xl surface-2 p-3 text-sm">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">{icon}</span>
              <InlineMarkdown>{it}</InlineMarkdown>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{empty ?? "–"}</p>
      )}
    </div>
  );
}
