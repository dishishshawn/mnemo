import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router";
import { db, type Concept, type Kit } from "./db";

/** undefined while loading, null if the kit doesn't exist. */
export function useKit(): { kitId: string; kit: Kit | null | undefined } {
  const { kitId = "" } = useParams();
  const kit = useLiveQuery(async () => (await db.kits.get(kitId)) ?? null, [kitId]);
  return { kitId, kit };
}

export function useConcepts(kitId: string): Concept[] | undefined {
  return useLiveQuery(() => db.concepts.where("kitId").equals(kitId).sortBy("order"), [kitId]);
}

export function overallMastery(concepts: Concept[]): number {
  if (!concepts.length) return 0;
  return concepts.reduce((n, c) => n + c.mastery, 0) / concepts.length;
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "mnemo";
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
