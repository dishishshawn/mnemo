import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ClipboardCheck, Timer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { Badge, Button, Card, ErrorBox, Field, inputClass, PageHeader, Spinner, MissingKit } from "../components/ui";
import { formatNumber, matches, parseAnswer } from "../lib/calc";
import { db, newId, type Question, type TestRun } from "../lib/db";
import { useKit } from "../lib/hooks";
import { applyAnswer } from "../lib/smart";
import { generateTestQuestions, gradeShortAnswers } from "../lib/study";

type QType = Question["type"];

/** A typed number is right within the tolerance of the app's own answer (calc.ts). */
const numericRight = (q: Question, typed = "") => {
  const v = parseAnswer(typed);
  return v !== null && !!q.numeric && matches(v, q.numeric.value);
};

export default function PracticeTest() {
  const { kitId, kit } = useKit();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const run = useLiveQuery(async () => (runId ? ((await db.tests.get(runId)) ?? null) : null), [runId]);
  const history = useLiveQuery(() => db.tests.where("kitId").equals(kitId).reverse().sortBy("startedAt"), [kitId]);

  if (kit === null) return <MissingKit />;

  if (!kit) return <Spinner label="Loading" />;
  if (runId && run === undefined) return <Spinner label="Loading" />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Practice test" subtitle={kit.title} back={run ? undefined : `/kit/${kitId}`} />
      {run ? (
        <TestView run={run} onExit={() => setParams({})} />
      ) : (
        <Setup kitId={kitId} quantitative={!!kit.quantitative} onStart={(id) => setParams({ run: id })} history={history ?? []} onOpen={(id) => setParams({ run: id })} />
      )}
    </div>
  );
}

function Setup({
  kitId,
  quantitative,
  onStart,
  history,
  onOpen,
}: {
  kitId: string;
  quantitative: boolean;
  onStart: (id: string) => void;
  history: TestRun[];
  onOpen: (id: string) => void;
}) {
  const [count, setCount] = useState(15);
  const [types, setTypes] = useState<QType[]>(quantitative ? ["mcq", "tf", "short", "numeric"] : ["mcq", "tf", "short"]);
  const [minutes, setMinutes] = useState(0);
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setLoading(true);
    setError("");
    try {
      const qs = await generateTestQuestions(kitId, { count, types, focus: focus.trim() || undefined });
      if (!qs.length) throw new Error("No questions came back. Try again.");
      const id = newId();
      await db.tests.add({ id, kitId, questionIds: qs.map((q) => q.id), answers: {}, timeLimitMin: minutes || undefined, startedAt: Date.now() });
      onStart(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (t: QType) => setTypes((ts) => (ts.includes(t) ? (ts.length > 1 ? ts.filter((x) => x !== t) : ts) : [...ts, t]));

  return (
    <div className="space-y-6">
      <Card className="space-y-5 p-5">
        <Field label="Questions" group>
          <div className="flex gap-2">
            {[10, 15, 25, 40].map((n) => (
              <button key={n} onClick={() => setCount(n)} className={clsx("flex-1 rounded-xl py-2 text-sm font-medium", count === n ? "bg-brand-300 text-brand-900 dark:bg-brand-500 dark:text-white" : "surface-2")}>
                {n}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Question types" group>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["mcq", "Multiple choice"],
                ["tf", "True / false"],
                ["short", "Short answer"],
                ...(quantitative ? [["numeric", "Calculation"]] : []),
              ] as [QType, string][]
            ).map(([t, label]) => (
              <button key={t} onClick={() => toggle(t)} className={clsx("rounded-xl px-3 py-2 text-sm font-medium", types.includes(t) ? "bg-brand-300 text-brand-900 dark:bg-brand-500 dark:text-white" : "surface-2")}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Time limit">
          <select className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            <option value={0}>No limit</option>
            {[10, 20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </Field>
        <Field label="Focus (optional)">
          <input className={inputClass} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. only chapters 4-5" />
        </Field>
        {error && <ErrorBox error={error} />}
        <Button size="lg" className="w-full" onClick={start} loading={loading}>
          <ClipboardCheck className="size-4" /> {loading ? "Writing your test…" : "Start test"}
        </Button>
      </Card>

      {history.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted">Past tests</h2>
          <div className="space-y-2">
            {history.map((t) => (
              <button key={t.id} onClick={() => onOpen(t.id)} className="flex w-full items-center justify-between rounded-xl surface px-4 py-3 text-left text-sm hover:border-brand-400">
                <span>
                  {new Date(t.startedAt).toLocaleString()} · {t.questionIds.length} questions
                </span>
                {t.score !== undefined ? <Badge tone={t.score >= 0.8 ? "green" : t.score >= 0.5 ? "amber" : "rose"}>{Math.round(t.score * 100)}%</Badge> : <Badge>In progress</Badge>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TestView({ run, onExit }: { run: TestRun; onExit: () => void }) {
  const questions = useLiveQuery(async () => {
    const qs = await db.questions.bulkGet(run.questionIds);
    return qs.filter((q): q is Question => !!q);
  }, [run.id]);
  const [answers, setAnswers] = useState<Record<string, string>>(run.answers);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const finished = !!run.finishedAt;
  const deadline = run.timeLimitMin ? run.startedAt + run.timeLimitMin * 60_000 : undefined;
  const remaining = deadline ? Math.max(0, deadline - now) : undefined;

  useEffect(() => {
    if (finished || !deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finished, deadline]);

  // Save answers as they're typed so a reload doesn't lose them.
  useEffect(() => {
    if (finished) return;
    const t = setTimeout(() => db.tests.update(run.id, { answers }), 400);
    return () => clearTimeout(t);
  }, [answers, finished, run.id]);
  // ...and flush whatever the debounce hadn't written yet when leaving the page.
  const latest = useRef(answers);
  latest.current = answers;
  useEffect(() => () => void db.tests.update(run.id, { answers: latest.current }), [run.id]);

  const submit = async () => {
    if (!questions) return;
    setGrading(true);
    setError("");
    try {
      const short = questions.filter((q) => q.type === "short");
      const graded = await gradeShortAnswers(
        run.kitId,
        short.map((q) => ({ id: q.id, question: q.prompt, modelAnswer: q.answer, studentAnswer: answers[q.id] ?? "", reveal: true })),
      );
      const results: NonNullable<TestRun["results"]> = {};
      for (const q of questions) {
        if (q.type === "short") {
          const g = graded.get(q.id);
          results[q.id] = { score: g?.score ?? 0, feedback: g?.feedback ?? "" };
        } else if (q.type === "numeric") {
          results[q.id] = { score: numericRight(q, answers[q.id]) ? 1 : 0, feedback: "" };
        } else {
          results[q.id] = { score: answers[q.id] === String(q.answerIndex) ? 1 : 0, feedback: "" };
        }
      }
      const score = questions.reduce((n, q) => n + results[q.id].score, 0) / questions.length;
      await db.transaction("rw", db.tests, db.attempts, db.concepts, async () => {
        await db.tests.update(run.id, { answers, results, score, finishedAt: Date.now() });
        const concepts = await db.concepts.where("kitId").equals(run.kitId).toArray();
        const byName = new Map(concepts.map((c) => [c.name, c]));
        for (const q of questions) {
          const r = results[q.id];
          await db.attempts.add({ id: newId(), kitId: run.kitId, questionId: q.id, concept: q.concept, mode: "test", response: answers[q.id] ?? "", score: r.score, usedHint: false, feedback: r.feedback, at: Date.now() });
          const c = byName.get(q.concept);
          if (c) byName.set(c.name, applyAnswer(c, r.score, false));
        }
        await db.concepts.bulkPut([...byName.values()]);
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGrading(false);
    }
  };

  useEffect(() => {
    // Also waits for the questions to load, for a test reopened after its deadline.
    if (remaining === 0 && questions && !finished && !grading) submit();
  }, [remaining, questions]);

  const answered = useMemo(() => Object.values(answers).filter((a) => a.trim()).length, [answers]);
  if (!questions) return <Spinner label="Loading test" />;

  return (
    <div className="space-y-4">
      <div className="sticky top-[calc(var(--appbar)-4.5px)] z-30 -mx-4 flex items-center justify-between gap-3 border-b border-theme bg-[var(--bg)]/90 px-4 py-2 backdrop-blur">
        {finished ? (
          <span className="text-lg font-bold">Score: {Math.round((run.score ?? 0) * 100)}%</span>
        ) : (
          <span className="text-sm text-muted">
            {answered}/{questions.length} answered
          </span>
        )}
        <div className="flex items-center gap-3">
          {remaining !== undefined && !finished && (
            <span className={clsx("flex items-center gap-1 text-sm tabular-nums", remaining < 60_000 && "font-bold text-rose-600")}>
              <Timer className="size-4" />
              {Math.floor(remaining / 60000)}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}
            </span>
          )}
          {finished ? (
            <Button size="sm" variant="secondary" onClick={onExit}>
              Done
            </Button>
          ) : (
            <Button size="sm" onClick={submit} loading={grading}>
              {grading ? "Grading…" : "Submit"}
            </Button>
          )}
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={submit} />}

      {questions.map((q, n) => {
        const result = run.results?.[q.id];
        return (
          <Card key={q.id} className="p-5">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">
              <span className="font-semibold">Q{n + 1}</span>
              <Badge>{q.concept}</Badge>
              {result && (
                <Badge tone={result.score >= 0.8 ? "green" : result.score > 0 ? "amber" : "rose"} className="ml-auto">
                  {result.score >= 0.8 ? <Check className="size-3" /> : <X className="size-3" />} {Math.round(result.score * 100)}%
                </Badge>
              )}
            </div>
            <InlineMarkdown className="mb-4 font-medium">{q.prompt}</InlineMarkdown>
            {q.type === "short" ? (
              <textarea
                className={clsx(inputClass, "min-h-24")}
                disabled={finished}
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder="Your answer"
              />
            ) : q.type === "numeric" ? (
              <div className="flex items-center gap-2">
                <input
                  className={clsx(inputClass, "flex-1 tabular-nums")}
                  disabled={finished}
                  value={answers[q.id] ?? ""}
                  autoComplete="off"
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  placeholder="Your answer, e.g. 3.2e8"
                />
                {q.numeric?.unit && <span className="shrink-0 text-sm text-muted">{q.numeric.unit}</span>}
              </div>
            ) : (
              <div className="space-y-2">
                {q.options.map((opt, i) => {
                  const chosen = answers[q.id] === String(i);
                  const correct = finished && i === q.answerIndex;
                  return (
                    <button
                      key={i}
                      disabled={finished}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: String(i) }))}
                      className={clsx(
                        "flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition",
                        correct && "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
                        finished && chosen && !correct && "border-blush-500 bg-blush-100 dark:bg-blush-700/25",
                        !finished && chosen && "border-brand-500 bg-brand-50 dark:bg-brand-950/40",
                        !correct && !chosen && "border-theme hover:border-brand-400",
                      )}
                    >
                      <span className={clsx("mt-0.5 size-4 shrink-0 rounded-full border-2", chosen ? "border-brand-600 bg-brand-400" : "border-[var(--border)]")} />
                      <InlineMarkdown className="flex-1">{opt}</InlineMarkdown>
                    </button>
                  );
                })}
              </div>
            )}
            {finished && (
              <div className="mt-4 space-y-2 border-t border-theme pt-3 text-sm">
                {result?.feedback && <InlineMarkdown>{result.feedback}</InlineMarkdown>}
                {q.type === "short" && (
                  <div className="rounded-lg surface-2 p-2">
                    <b>Model answer:</b> <InlineMarkdown className="inline">{q.answer}</InlineMarkdown>
                  </div>
                )}
                {q.type === "numeric" && q.numeric && (
                  <div className="space-y-1 rounded-lg surface-2 p-2">
                    <InlineMarkdown className="font-semibold">{`Answer: ${formatNumber(q.numeric.value)}${q.numeric.unit ? ` ${q.numeric.unit}` : ""}`}</InlineMarkdown>
                    <InlineMarkdown className="text-muted">{q.answer}</InlineMarkdown>
                  </div>
                )}
                <Markdown className="text-sm text-muted">{q.explanation}</Markdown>
              </div>
            )}
          </Card>
        );
      })}

      {!finished && (
        <Button size="lg" className="w-full" onClick={submit} loading={grading}>
          Submit test
        </Button>
      )}
    </div>
  );
}
