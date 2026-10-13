import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";

const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 });

export { Rating, State };
export type { Card, Grade };

export function newCard(now = new Date()): Card {
  return createEmptyCard(now);
}

/** Dates turn into strings after a JSON export/import round-trip; restore them. */
export function reviveCard(card: Card): Card {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

export function review(card: Card, grade: Grade, now = new Date()): Card {
  return scheduler.next(reviveCard(card), now, grade).card;
}

/** Preview the next interval for each grade, for the buttons under a flashcard. */
export function preview(card: Card, now = new Date()): Record<Grade, Date> {
  const p = scheduler.repeat(reviveCard(card), now);
  return {
    [Rating.Again]: p[Rating.Again].card.due,
    [Rating.Hard]: p[Rating.Hard].card.due,
    [Rating.Good]: p[Rating.Good].card.due,
    [Rating.Easy]: p[Rating.Easy].card.due,
  } as Record<Grade, Date>;
}

export function isDue(card: Card, now = new Date()): boolean {
  return new Date(card.due).getTime() <= now.getTime();
}

/** Probability the student still remembers it now, 0..1. New cards are 0. */
export function retrievability(card: Card, now = new Date()): number {
  if (card.state === State.New) return 0;
  return scheduler.get_retrievability(reviveCard(card), now, false);
}

export function formatInterval(due: Date, now = new Date()): string {
  const mins = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
