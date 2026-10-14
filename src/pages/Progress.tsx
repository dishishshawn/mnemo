import { useLiveQuery } from "dexie-react-hooks";
import { ForecastCurve, useStudyPlan } from "../components/ExamPlan";
import { Card, PageHeader, Spinner, MissingKit } from "../components/ui";
import { db } from "../lib/db";
import { useConcepts, useKit } from "../lib/hooks";
import { TARGET_RETENTION } from "../lib/plan";
import { levelOf } from "../lib/smart";
import { formatInterval, isDue } from "../lib/srs";

function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Consecutive days (ending today or yesterday) with at least one answer. */
function streak(times: number[]): number {
  const days = new Set(times.map(dayKey));
  const d = new Date();
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export default function ProgressPage() {
  const { kitId, kit } = useKit();
  const concepts = useConcepts(kitId);
  const plan = useStudyPlan(kitId, kit?.examDate);
  const data = useLiveQuery(async () => {
    const [attempts, cards, tests, questions] = await Promise.all([
      db.attempts.where("kitId").equals(kitId).toArray(),
      db.flashcards.where("kitId").equals(kitId).toArray(),
      db.tests.where("kitId").equals(kitId).toArray(),
      db.questions.where("kitId").equals(kitId).toArray(),
    ]);
    return { attempts: attempts.sort((a, b) => b.at - a.at), cards, tests: tests.filter((t) => t.finishedAt).sort((a, b) => b.startedAt - a.startedAt), questions: new Map(questions.map((q) => [q.id, q])) };
  }, [kitId]);

  if (kit === null) return <MissingKit />;

  if (!kit || !concepts || !data) return <Spinner label="Loading" />;

  const { attempts, cards, tests, questions } = data;
  const accuracy = attempts.length ? attempts.reduce((n, a) => n + a.score, 0) / attempts.length : 0;
  const sorted = [...concepts].sort((a, b) => (a.attempts === 0 ? 2 : a.mastery) - (b.attempts === 0 ? 2 : b.mastery));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Progress" subtitle={kit.title} back={`/kit/${kitId}`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Questions answered" value={String(attempts.length)} />
        <Stat label="Average score" value={attempts.length ? `${Math.round(accuracy * 100)}%` : "–"} />
        <Stat label="Day streak" value={String(streak(attempts.map((a) => a.at)))} />
        <Stat label="Cards due" value={String(cards.filter((c) => isDue(c.srs)).length)} />
      </div>

      {plan && (
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Exam-day forecast</h2>
          <p className="mb-3 text-xs text-muted">
            What you're predicted to still recall, day by day, if you stopped studying now. Each answer you give moves the curve up.
          </p>
          <ForecastCurve plan={plan} className="mb-4" />
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Recall on exam day" value={`${Math.round(plan.readiness * 100)}%`} sub={`target ${Math.round(TARGET_RETENTION * 100)}%`} />
            <Stat label="Concepts ready" value={`${Math.round(plan.readyShare * 100)}%`} sub="above target with no more study" />
            <Stat label="To do before the exam" value={plan.over ? "–" : String(plan.forecasts.reduce((n, f) => n + f.reviewsNeeded, 0))} sub={plan.over ? "exam day" : `reviews · ${plan.questionsPerDay}/day`} />
          </div>
          {!plan.over && plan.forecasts.some((f) => f.onExamDay < TARGET_RETENTION) && (
            <>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Most at risk</div>
              <ul className="divide-y divide-[var(--border)] text-sm">
                {plan.forecasts
                  .filter((f) => f.onExamDay < TARGET_RETENTION)
                  .slice(0, 8)
                  .map((f) => (
                    <li key={f.concept.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="truncate">{f.concept.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {f.concept.attempts === 0 ? "not started" : `${Math.round(f.onExamDay * 100)}% on exam day`} · {f.reviewsNeeded} review{f.reviewsNeeded === 1 ? "" : "s"} needed
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-1 font-semibold">Mastery by concept</h2>
        <p className="mb-4 text-xs text-muted">Weakest first. Smart Study prioritises these, plus anything due for review.</p>
        <div className="space-y-3">
          {sorted.map((c) => {
            const level = levelOf(c);
            return (
              <div key={c.id} title={c.summary}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {level === "new" ? "not practised yet" : `${Math.round(c.mastery * 100)}% · ${level} · ${c.correct}/${c.attempts} right · review ${isDue(c.srs) ? "now" : `in ${formatInterval(new Date(c.srs.due))}`}`}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded surface-2">
                  <div className="h-full rounded bg-brand-400 transition-all" style={{ width: `${Math.round(c.mastery * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {tests.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Practice tests</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Questions</th>
                <th className="pb-2 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id} className="border-t border-theme">
                  <td className="py-2">{new Date(t.startedAt).toLocaleDateString()}</td>
                  <td className="py-2">{t.questionIds.length}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{Math.round((t.score ?? 0) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {attempts.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Recent answers</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {attempts.slice(0, 30).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="line-clamp-2">{a.mode === "explain" ? `Explained ${a.concept} in your own words` : (questions.get(a.questionId)?.prompt ?? "(question removed)")}</div>
                  <div className="text-xs text-muted">
                    {a.concept} · {a.mode === "smart" ? "Smart Study" : a.mode === "explain" ? "Explain it back" : "Test"} · {new Date(a.at).toLocaleDateString()}
                    {a.usedHint && " · used hint"}
                  </div>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{a.score >= 0.8 ? "✓" : a.score > 0 ? "~" : "✗"} {Math.round(a.score * 100)}%</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}
