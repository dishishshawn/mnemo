import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarCheck, CalendarClock } from "lucide-react";
import { Link } from "react-router";
import { db, type Kit } from "../lib/db";
import { buildPlan, formatDaysLeft, formatMinutes, TARGET_RETENTION, todayKey, type StudyPlan } from "../lib/plan";
import { Penguin, type Mood } from "./Penguin";
import { Badge, Card, inputClass, Progress } from "./ui";

/** The kit's study plan, recomputed whenever its concepts or attempts change. Null without an exam date. */
export function useStudyPlan(kitId: string, examDate?: string): StudyPlan | null | undefined {
  return useLiveQuery(async () => {
    if (!examDate) return null;
    const [concepts, attempts] = await Promise.all([
      db.concepts.where("kitId").equals(kitId).toArray(),
      db.attempts.where("kitId").equals(kitId).toArray(),
    ]);
    return buildPlan(examDate, concepts, attempts);
  }, [kitId, examDate]);
}

export function ExamDateField({ kit }: { kit: Kit }) {
  return (
    <label className="text-xs text-muted">
      Exam date
      <input
        type="date"
        className={inputClass}
        value={kit.examDate ?? ""}
        min={todayKey()}
        onChange={(e) => db.kits.update(kit.id, { examDate: e.target.value || undefined })}
      />
    </label>
  );
}

const STATUS: Record<StudyPlan["status"], { label: string; tone: "green" | "brand" | "amber" | "neutral" }> = {
  ahead: { label: "Done for today", tone: "green" },
  "on-track": { label: "On track", tone: "brand" },
  behind: { label: "Behind today", tone: "amber" },
  done: { label: "Ready", tone: "green" },
};

/** A compact "Exam in N days" badge for kit lists. */
export function PlanBadge({ plan }: { plan: StudyPlan }) {
  const s = STATUS[plan.status];
  return (
    <Badge tone={plan.over ? "neutral" : s.tone}>
      <CalendarClock className="size-3" /> {plan.over ? "Exam day" : `${plan.daysLeft}d`}
    </Badge>
  );
}

/** The plan card on the kit page: countdown, today's quota, and readiness. */
export function PlanCard({ kitId, plan }: { kitId: string; plan: StudyPlan }) {
  const s = STATUS[plan.status];
  const quotaDone = plan.questionsPerDay > 0 ? Math.min(1, plan.doneToday / plan.questionsPerDay) : 1;
  const mood: Mood = plan.status === "behind" ? "oops" : plan.status === "on-track" ? (plan.doneToday > 0 ? "thinking" : "idle") : plan.status === "ahead" && new Date().getHours() >= 21 ? "sleeping" : "cheer";
  return (
    <Card className="relative mb-6 overflow-hidden p-5 sm:pr-28">
      {/* Positioned by a wrapper: the penguin's own box is position: relative. */}
      <div className="absolute top-4 right-3">
        <Penguin mood={mood} size="sm" className="sm:size-24" />
      </div>
      {/* On phones the penguin sits beside this row only; from sm up he spans the card. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 pr-14 sm:pr-0">
        <div className="flex items-center gap-2 font-semibold">
          <CalendarCheck className="size-5 text-brand-600" />
          {formatDaysLeft(plan.daysLeft, plan.over)}
          <span className="text-sm font-normal text-muted">{new Date(plan.examDate + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>

      {plan.over ? (
        <p className="text-sm text-muted">
          Good luck. You're predicted to recall about <b>{Math.round(plan.readiness * 100)}%</b> of the material today. Set a new date after the exam to keep going.
        </p>
      ) : plan.questionsPerDay === 0 ? (
        <p className="text-sm text-muted">Everything is predicted to hold until the exam. Keep answering what comes due and you're set.</p>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span>
              Today:{" "}
              {plan.doneToday >= plan.questionsPerDay ? (
                <>
                  <b>{plan.doneToday}</b> questions (goal {plan.questionsPerDay})
                </>
              ) : (
                <>
                  <b>{plan.doneToday}</b> of <b>{plan.questionsPerDay}</b> questions
                </>
              )}
              <span className="block text-muted sm:inline">
                <span className="hidden sm:inline"> · </span>about {formatMinutes(plan.minutesPerDay)} a day
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted">{Math.round(quotaDone * 100)}%</span>
          </div>
          <Progress value={quotaDone} tone={plan.status === "ahead" ? "green" : plan.status === "behind" ? "amber" : "brand"} />
          <p className="mt-2 text-xs text-muted">
            {plan.leftToday > 0 ? (
              <>
                <Link to={`/kit/${kitId}/smart`} className="font-medium text-brand-600 hover:underline">
                  {plan.leftToday} more in Smart Study
                </Link>{" "}
                and you're on pace.
              </>
            ) : (
              "Today's goal is met. Anything extra makes exam day easier."
            )}{" "}
            Stop now and you'd remember about <b>{Math.round(plan.readiness * 100)}%</b> by exam day; keeping to the plan gets you to {Math.round(TARGET_RETENTION * 100)}%.
          </p>
        </>
      )}
    </Card>
  );
}

/** Mean predicted recall per day until the exam, as a small inline chart. */
export function ForecastCurve({ plan, className }: { plan: StudyPlan; className?: string }) {
  const pts = plan.curve;
  if (pts.length < 2) return null;
  const W = 600;
  const H = 140;
  const padL = 34;
  const padB = 22;
  const padT = 8;
  const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - 6);
  const y = (r: number) => padT + (1 - r) * (H - padT - padB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.retention).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const targetY = y(TARGET_RETENTION);
  const labelEvery = Math.max(1, Math.ceil(pts.length / 6));
  const short = (day: string) => new Date(day + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={clsx("w-full", className)} role="img" aria-label="Predicted recall until the exam">
      {[0, 0.5, 1].map((r) => (
        <g key={r}>
          <line x1={padL} x2={W - 6} y1={y(r)} y2={y(r)} stroke="currentColor" strokeOpacity={0.12} />
          <text x={padL - 6} y={y(r) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {Math.round(r * 100)}%
          </text>
        </g>
      ))}
      <line x1={padL} x2={W - 6} y1={targetY} y2={targetY} stroke="#059669" strokeDasharray="4 4" strokeOpacity={0.8} />
      <text x={W - 8} y={targetY - 4} textAnchor="end" fontSize={11} fill="#059669">
        target
      </text>
      <path d={area} fill="#6797d0" fillOpacity={0.12} />
      <path d={line} fill="none" stroke="#6797d0" strokeWidth={2.5} strokeLinejoin="round" />
      {pts.map((p, i) =>
        i % labelEvery === 0 || i === pts.length - 1 ? (
          <text key={p.day} x={x(i)} y={H - 6} textAnchor={i === pts.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {i === 0 ? "today" : i === pts.length - 1 ? "exam" : short(p.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
