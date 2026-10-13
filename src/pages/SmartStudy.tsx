import clsx from "clsx";
import { Check, Eye, Lightbulb, Sparkles, Target, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { InlineMarkdown, Markdown } from "../components/Markdown";
import { useStudyPlan } from "../components/ExamPlan";
import { Badge, Button, Card, ErrorBox, inputClass, PageHeader, Progress, Spinner, MissingKit } from "../components/ui";
import { db, newId, type Concept, type Question } from "../lib/db";
import { useConcepts, useKit } from "../lib/hooks";
import { applyAnswer, BATCH_SIZE, levelOf, needsMore, pickQuestion, pickTargets } from "../lib/smart";
import { generateSmartQuestions, gradeShortAnswers } from "../lib/study";

const ROUND = 10;
type Phase = "answering" | "retry" | "done";
export type Mode = "choice" | "short";

/** Smart Study asks multiple choice and true/false; the Short answers section asks the written ones. */
const TYPES: Record<Mode, Question["type"][]> = { choice: ["mcq", "tf"], short: ["short"] };
const TITLES: Record<Mode, string> = { choice: "Smart Study", short: "Short answers" };

interface Outcome {
  score: number;
  feedback?: string;
}

export default function SmartStudy({ mode = "choice" }: { mode?: Mode }) {
  const { kitId, kit } = useKit();
  const types = TYPES[mode];
  const concepts = useConcepts(kitId);
  const plan = useStudyPlan(kitId, kit?.examDate);
  const [steer, setSteer] = useState("");
  const [focus, setFocus] = useState<string[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [phase, setPhase] = useState<Phase>("answering");
  const [picked, setPicked] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<string>("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState<string>("");
  const [error, setError] = useState("");
  const [round, setRound] = useState({ answered: 0, score: 0 });
  const [showSetup, setShowSetup] = useState(false);
  const recent = useRef<string[]>([]);
  const prefetching = useRef(false);
  const started = useRef(false);
  const advancing = useRef(false);
  const askedIds = useRef(new Set<string>());
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const targetsFor = useCallback((all: Concept[]) => pickTargets(all, 4, new Date(), focus), [focus]);

  const generate = useCallback(
    async (all: Concept[]) => {
      const targets = targetsFor(all);
      await generateSmartQuestions(
        kitId,
        targets.map((t) => ({ name: t.name, mastery: t.mastery, attempts: t.attempts })),
        { count: BATCH_SIZE, steer: steer.trim() || undefined, types },
      );
    },
    [kitId, steer, targetsFor, types],
  );

  const next = useCallback(async () => {
    if (advancing.current) return;
    advancing.current = true;
    try {
      await advance();
    } finally {
      advancing.current = false;
    }
  }, [kitId, targetsFor, generate]);

  const advance = async () => {
    setError("");
    // The last answer must be saved (askedAt) before picking, or the same question can come back.
    await saving.current;
    const fresh = (pool: Question[]) => pool.filter((p) => !askedIds.current.has(p.id) && types.includes(p.type));
    const all = await db.concepts.where("kitId").equals(kitId).sortBy("order");
    if (!all.length) return setError("This kit has no concepts yet.");
    const targets = targetsFor(all);
    let pool = fresh(await db.questions.where("[kitId+origin]").equals([kitId, "smart"]).toArray());
    let q = pickQuestion(pool, targets, recent.current) ?? pickQuestion(pool, all, recent.current);
    if (!q) {
      setQuestion(null);
      setLoading("Writing questions for you");
      try {
        await generate(all);
      } catch (err) {
        setLoading("");
        return setError((err as Error).message);
      }
      setLoading("");
      pool = fresh(await db.questions.where("[kitId+origin]").equals([kitId, "smart"]).toArray());
      q = pickQuestion(pool, targets, recent.current) ?? pickQuestion(pool, all, recent.current);
      if (!q) return setError("Couldn't create questions for this material. Try again or change the focus.");
    } else if (needsMore(pool, targets) && !prefetching.current) {
      // Top up in the background so the next question is instant.
      prefetching.current = true;
      generate(all)
        .catch(() => {})
        .finally(() => (prefetching.current = false));
    }
    // Swap everything in one render so the old question never flashes back as unanswered.
    setPhase("answering");
    setPicked([]);
    setText("");
    setFeedback("");
    setOutcome(null);
    setQuestion(q);
  };

  useEffect(() => {
    if (kit?.status === "ready" && concepts?.length && !started.current) {
      started.current = true;
      next();
    }
  }, [kit, concepts, next]);

  const finish = async (q: Question, score: number, usedHint: boolean, response: string, fb?: string) => {
    setPhase("done");
    setOutcome({ score, feedback: fb });
    recent.current = [...recent.current, q.concept].slice(-5);
    // Needing a hint still counts, just for less (applyAnswer applies the same discount to mastery).
    setRound((r) => ({ answered: r.answered + 1, score: r.score + (usedHint ? score * 0.6 : score) }));
    askedIds.current.add(q.id);
    const save = (async () => {
    const concept = await db.concepts.where("kitId").equals(kitId).filter((c) => c.name === q.concept).first();
    await db.transaction("rw", db.concepts, db.questions, db.attempts, db.kits, async () => {
      if (concept) await db.concepts.put(applyAnswer(concept, score, usedHint));
      await db.questions.update(q.id, { askedAt: Date.now(), asks: (q.asks ?? 0) + 1, lastScore: score });
      await db.attempts.add({ id: newId(), kitId, questionId: q.id, concept: q.concept, mode: "smart", response, score, usedHint, feedback: fb, at: Date.now() });
      await db.kits.update(kitId, { lastStudiedAt: Date.now() });
    });
    })();
    saving.current = save;
    await save;
  };

  const choose = (i: number) => {
    if (!question || phase === "done" || picked.includes(i)) return;
    setPicked((p) => [...p, i]);
    if (i === question.answerIndex) return finish(question, 1, phase === "retry", question.options[i]);
    // True/false has no second try: the only other option is the answer.
    if (phase === "answering" && question.type === "mcq") return setPhase("retry");
    finish(question, 0, phase === "retry", question.options[i]);
  };

  const submitShort = async () => {
    if (!question || !text.trim()) return;
    const reveal = phase === "retry";
    setLoading("Checking your answer");
    try {
      const results = await gradeShortAnswers(kitId, [
        { id: "a", question: question.prompt, modelAnswer: question.answer, studentAnswer: text, reveal },
      ]);
      const r = results.get("a")!;
      setLoading("");
      if (r.verdict === "correct" || reveal) return finish(question, r.score, reveal, text, r.feedback);
      setFeedback(r.feedback);
      setPhase("retry");
    } catch (err) {
      setLoading("");
      setError((err as Error).message);
    }
  };

  const giveUp = () => question && finish(question, 0, phase === "retry", "(revealed)");

  const roundDone = round.answered > 0 && round.answered % ROUND === 0 && phase === "done";
  const keepGoing = () => {
    setRound({ answered: 0, score: 0 });
    next();
  };

  // Keyboard: 1-4 to answer, Enter for next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT") return;
      if (phase === "done" && e.key === "Enter") (roundDone ? keepGoing : next)();
      if (question && question.type !== "short" && /^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (kit === null) return <MissingKit />;

  if (!kit || !concepts) return <Spinner label="Loading" />;

  const currentConcept = concepts.find((c) => c.name === question?.concept);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={TITLES[mode]}
        subtitle={kit.title}
        back={`/kit/${kitId}`}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setShowSetup((s) => !s)}>
            <Target className="size-4" /> Steer
          </Button>
        }
      />

      {showSetup && (
        <Card className="mb-4 space-y-3 p-4">
          <div>
            <div className="mb-2 text-sm font-medium">Focus on concepts</div>
            <div className="flex flex-wrap gap-1.5">
              {concepts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setFocus((f) => (f.includes(c.name) ? f.filter((x) => x !== c.name) : [...f, c.name]))}
                  className={clsx(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition",
                    focus.includes(c.name) ? "bg-brand-700 text-white" : "surface-2 text-muted hover:text-[var(--text)]",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <input
            className={inputClass}
            placeholder='Tell it what you want, e.g. "harder questions", "exam on Friday, focus on chapter 3"'
            value={steer}
            onChange={(e) => setSteer(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => {
              setShowSetup(false);
              next();
            }}
          >
            Apply
          </Button>
        </Card>
      )}

      <div className="mb-4 flex items-center gap-3">
        <Progress value={(round.answered % ROUND) / ROUND || (roundDone ? 1 : 0)} className="flex-1" />
        <span className="text-xs tabular-nums text-muted">
          {round.answered % ROUND || (roundDone ? ROUND : 0)}/{ROUND}
        </span>
      </div>
      {plan && !plan.over && plan.questionsPerDay > 0 && (
        <p className="-mt-2 mb-4 text-xs text-muted">
          {plan.leftToday > 0 ? (
            <>
              <b>{plan.leftToday}</b> more today to stay on pace for the exam in {plan.daysLeft} day{plan.daysLeft === 1 ? "" : "s"}.
            </>
          ) : (
            <>Today's quota done. Anything more is a head start on tomorrow.</>
          )}
        </p>
      )}

      {error && <ErrorBox error={error} onRetry={next} />}
      {loading && !question && (
        <Card className="p-8">
          <Spinner label={loading} />
        </Card>
      )}

      {question && (
        <Card className="animate-pop p-5" key={question.id}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="brand">{question.concept}</Badge>
            {currentConcept && <Badge>{levelOf(currentConcept)}</Badge>}
            <Badge>{"●".repeat(question.difficulty)}{"○".repeat(3 - question.difficulty)}</Badge>
            {question.askedAt && <Badge tone="amber">missed before</Badge>}
          </div>
          <InlineMarkdown className="mb-5 text-lg font-medium leading-relaxed">{question.prompt}</InlineMarkdown>

          {question.type !== "short" ? (
            <div className="space-y-2">
              {question.options.map((opt, i) => {
                const isPicked = picked.includes(i);
                const isAnswer = i === question.answerIndex;
                const show = phase === "done";
                return (
                  <button
                    key={i}
                    onClick={() => choose(i)}
                    disabled={phase === "done" || isPicked}
                    className={clsx(
                      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
                      show && isAnswer && "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30",
                      isPicked && !isAnswer && "animate-shake border-rose-400 bg-rose-50 dark:bg-rose-950/30",
                      !(show && isAnswer) && !isPicked && "border-theme hover:border-brand-400 hover:bg-[var(--surface-2)]",
                    )}
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md surface-2 text-xs font-semibold">
                      {show && isAnswer ? <Check className="size-4 text-emerald-600" /> : isPicked ? <X className="size-4 text-rose-600" /> : i + 1}
                    </span>
                    <InlineMarkdown className="flex-1 text-sm">{opt}</InlineMarkdown>
                  </button>
                );
              })}
            </div>
          ) : (
            phase !== "done" && (
              <div className="space-y-3">
                <textarea
                  className={clsx(inputClass, "min-h-28")}
                  placeholder="Explain in your own words…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submitShort()}
                />
                <Button onClick={submitShort} loading={!!loading} disabled={!text.trim()}>
                  {phase === "retry" ? "Try again" : "Check answer"}
                </Button>
              </div>
            )
          )}

          {phase === "retry" && (
            <div className="mt-4 flex gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <Lightbulb className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                {feedback ? <InlineMarkdown>{feedback}</InlineMarkdown> : <b>Not quite. Here's a nudge:</b>}
                <InlineMarkdown>{question.hint}</InlineMarkdown>
              </div>
            </div>
          )}

          {phase !== "done" && (
            <button onClick={giveUp} className="mt-4 flex items-center gap-1.5 text-sm text-muted hover:text-[var(--text)]">
              <Eye className="size-4" /> Show me the answer
            </button>
          )}

          {phase === "done" && outcome && (
            <div className="mt-5 space-y-3">
              <div
                className={clsx(
                  "rounded-xl p-3 text-sm font-medium",
                  outcome.score >= 0.8
                    ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                    : outcome.score > 0
                      ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                      : "bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100",
                )}
              >
                {outcome.score >= 0.8 ? "Nice, that's right." : outcome.score > 0 ? "Partly there." : "Let's lock this one in."}
                {outcome.feedback && <InlineMarkdown className="mt-1 font-normal">{outcome.feedback}</InlineMarkdown>}
              </div>
              {question.type === "short" && (
                <div className="rounded-xl surface-2 p-3 text-sm">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Model answer</div>
                  <InlineMarkdown>{question.answer}</InlineMarkdown>
                </div>
              )}
              <Markdown className="text-sm">{question.explanation}</Markdown>
              {roundDone ? (
                <RoundSummary answered={ROUND} score={round.score} concepts={concepts} onContinue={keepGoing} />
              ) : (
                <Button onClick={next} loading={!!loading} className="w-full">
                  Next question
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      <ConceptStrip concepts={concepts} active={question?.concept} />
    </div>
  );
}

function RoundSummary({ answered, score, concepts, onContinue }: { answered: number; score: number; concepts: Concept[]; onContinue: () => void }) {
  const weakest = [...concepts].filter((c) => c.attempts > 0).sort((a, b) => a.mastery - b.mastery).slice(0, 3);
  return (
    <Card className="space-y-3 border-brand-300 p-4">
      <div className="flex items-center gap-2 font-semibold">
        <Sparkles className="size-4 text-brand-600" /> Round complete: {Math.round((score / answered) * 100)}%
      </div>
      {weakest.length > 0 && (
        <p className="text-sm text-muted">
          Coming up next: more on <b>{weakest.map((c) => c.name).join(", ")}</b>.
        </p>
      )}
      <Button onClick={onContinue} className="w-full">
        Keep going
      </Button>
    </Card>
  );
}

function ConceptStrip({ concepts, active }: { concepts: Concept[]; active?: string }) {
  return (
    <div className="mt-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Concept mastery</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {concepts.map((c) => (
          <div key={c.id} className={clsx("rounded-xl px-3 py-2 transition", c.name === active ? "surface border-brand-400" : "surface-2")}>
            <div className="mb-1 flex justify-between gap-2 text-xs">
              <span className="truncate font-medium">{c.name}</span>
              <span className="tabular-nums text-muted">{c.attempts ? `${Math.round(c.mastery * 100)}%` : "new"}</span>
            </div>
            <Progress value={c.mastery} tone={c.mastery >= 0.75 ? "green" : c.mastery >= 0.4 ? "brand" : c.attempts ? "amber" : "brand"} className="h-1.5" />
          </div>
        ))}
      </div>
    </div>
  );
}
