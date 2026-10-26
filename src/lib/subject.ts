// What a kit is about. It decides the question styles and notation the prompts ask for
// (prompts.ts subjectGuidance), whether structures are drawn, and which extras the kit shows.

export type Subject = "biology" | "organic-chemistry" | "biochemistry" | "chemistry" | "other";

export const SUBJECTS: { value: Subject; label: string }[] = [
  { value: "biology", label: "Biology" },
  { value: "organic-chemistry", label: "Organic chemistry" },
  { value: "biochemistry", label: "Biochemistry" },
  { value: "chemistry", label: "Chemistry" },
  { value: "other", label: "Something else" },
];

export const isSubject = (s: unknown): s is Subject => SUBJECTS.some((x) => x.value === s);

/** Subjects whose molecules are drawn from structure tokens (chem.ts). */
export const drawsStructures = (s?: Subject) => s === "organic-chemistry" || s === "biochemistry" || s === "chemistry";

/** Subjects with a reaction sheet. */
export const hasReactions = (s?: Subject) => s === "organic-chemistry";
