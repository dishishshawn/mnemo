// Every generation call is laid out as [SYSTEM][<material>…</material>][task]. Keeping the system
// instruction constant and the material first means repeat calls on the same kit share a long
// prefix, which Gemini's implicit cache bills at 10% of the input price.

import type { Content } from "@google/genai";

export const SYSTEM = `You are Mnemo, an expert teacher and study coach.
You build study material strictly from the student's course material, given inside <material> tags.
- Stay faithful to the material. Do not introduce facts it does not support, except standard background knowledge that is needed to make sense of it.
- Prefer understanding over trivia: ask about ideas, mechanisms, relationships and applications, not page numbers or incidental wording.
- Write clearly for a university student. Use Markdown. Use LaTeX with $...$ or $$...$$ for math and chemistry.
- Follow the language instruction in each task exactly.`;

export function languageLine(language: string): string {
  return language === "auto"
    ? "Write everything in the same language as the material (if mixed, use the dominant one)."
    : `Write everything in ${language}, even if the material is in another language.`;
}

/** Builds the contents array: material first (cacheable), task last. */
export function withMaterial(material: string, task: string): Content[] {
  return [
    {
      role: "user",
      parts: [{ text: `<material>\n${material}\n</material>` }, { text: task }],
    },
  ];
}

// ---------- Kit analysis ----------

export const analyzeSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short kit title, max 60 characters" },
    description: { type: "string", description: "One or two sentences describing what the material covers" },
    emoji: { type: "string", description: "A single emoji that fits the subject" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Concept name, max 6 words" },
          summary: { type: "string", description: "One sentence on what the student must understand" },
        },
        required: ["name", "summary"],
      },
    },
  },
  required: ["title", "description", "emoji", "concepts"],
};

export interface AnalyzeResult {
  title: string;
  description: string;
  emoji: string;
  concepts: { name: string; summary: string }[];
}

export function analyzeTask(language: string): string {
  return `Task: map this material for study.
Identify the key concepts a student must master, in the order the material presents them. Use between 5 and 30 concepts depending on how much material there is; merge minor points into broader concepts rather than listing every fact.
${languageLine(language)}`;
}

// ---------- Flashcards ----------

export const flashcardSchema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["term", "qa"] },
          front: { type: "string" },
          back: { type: "string" },
          concept: { type: "string", description: "Name of the concept this card belongs to" },
        },
        required: ["kind", "front", "back", "concept"],
      },
    },
  },
  required: ["cards"],
};

export interface FlashcardResult {
  cards: { kind: "term" | "qa"; front: string; back: string; concept: string }[];
}

export function flashcardTask(opts: {
  language: string;
  count: number;
  concepts: string[];
  existingFronts: string[];
  focus?: string;
}): string {
  return `Task: write ${opts.count} flashcards.
- About 60% "term" cards: front is a key term or name (1 to 4 words, no question mark); back is a precise definition in at most 25 words.
- The rest "qa" cards: front is a focused question that tests understanding; back is the answer in at most 40 words.
- Spread cards across these concepts: ${opts.concepts.join("; ")}.
- Each card tests exactly one idea. Do not repeat these existing fronts: ${opts.existingFronts.length ? opts.existingFronts.slice(0, 200).join(" | ") : "(none)"}.
${opts.focus ? `- The student asked to focus on: ${opts.focus}\n` : ""}${languageLine(opts.language)}`;
}

// ---------- Questions (Smart Study and practice tests) ----------

export const questionSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          concept: { type: "string" },
          type: { type: "string", enum: ["mcq", "tf", "short"] },
          difficulty: { type: "integer", minimum: 1, maximum: 3, description: "1, 2 or 3" },
          prompt: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "mcq: exactly 4 options. tf: [\"True\", \"False\"]. short: empty array.",
          },
          answerIndex: { type: "integer", description: "Index of the correct option; -1 for short answer" },
          answer: { type: "string", description: "The model answer, 1 to 3 sentences" },
          explanation: { type: "string", description: "Why the answer is right and the tempting wrong answers are wrong" },
          hint: { type: "string", description: "A Socratic nudge that points toward the idea without giving the answer away" },
        },
        required: ["concept", "type", "difficulty", "prompt", "options", "answerIndex", "answer", "explanation", "hint"],
      },
    },
  },
  required: ["questions"],
};

export interface QuestionResult {
  questions: {
    concept: string;
    type: "mcq" | "tf" | "short";
    difficulty: number;
    prompt: string;
    options: string[];
    answerIndex: number;
    answer: string;
    explanation: string;
    hint: string;
  }[];
}

export interface QuestionTarget {
  name: string;
  /** 0..1 */
  mastery: number;
  attempts: number;
}

export function questionTask(opts: {
  language: string;
  count: number;
  targets: QuestionTarget[];
  types: ("mcq" | "tf" | "short")[];
  avoid: string[];
  steer?: string;
  purpose: "smart" | "test";
}): string {
  const targets = opts.targets
    .map((t) => {
      const level = t.attempts === 0 ? "new" : t.mastery < 0.4 ? "weak" : t.mastery < 0.75 ? "developing" : "strong";
      return `- ${t.name} (${level})`;
    })
    .join("\n");
  return `Task: write ${opts.count} ${opts.purpose === "test" ? "exam-style practice test" : "adaptive practice"} questions.
Target concepts and the student's current level:
${targets}

Difficulty: 1 = recall a key fact or definition; 2 = explain or apply an idea to a new example; 3 = analyse, compare, or solve a multi-step problem.
${
  opts.purpose === "smart"
    ? "Match difficulty to level: new -> mostly 1, weak -> 1 or 2, developing -> 2, strong -> 3. Put more questions on weak and new concepts."
    : "Cover every target concept at least once, with a realistic exam mix of difficulties (roughly 30% level 1, 50% level 2, 20% level 3)."
}
Allowed types: ${opts.types.join(", ")}. Use a mix if more than one is allowed.
- mcq: exactly 4 options, one clearly correct; distractors must be plausible misconceptions, similar in length and style. Never use "all of the above" or "none of the above".
- tf: a precise statement; avoid trick wording and absolute words used only to make it false.
- short: answerable in 1 to 3 sentences; the model answer lists the essential points a grader should look for.
- The hint must never reveal the answer; ask a guiding question or point at the relevant idea.
${opts.avoid.length ? `Do not repeat or closely paraphrase these earlier questions:\n${opts.avoid.slice(-60).map((q) => `- ${q}`).join("\n")}\n` : ""}${
    opts.steer ? `The student asked: "${opts.steer}". Follow that where the material allows.\n` : ""
  }${languageLine(opts.language)}`;
}

// ---------- Grading free-text answers (fast model, no material: cheap) ----------

export const gradeSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
          score: { type: "number", description: "0 to 1" },
          feedback: { type: "string" },
        },
        required: ["id", "verdict", "score", "feedback"],
      },
    },
  },
  required: ["results"],
};

export interface GradeResult {
  results: { id: string; verdict: "correct" | "partial" | "incorrect"; score: number; feedback: string }[];
}

export const GRADER_SYSTEM = `You grade students' short answers against a model answer.
- Judge meaning, not wording. Accept synonyms, paraphrases, and minor spelling mistakes.
- "correct" (score 1): all essential points present and nothing wrong. "partial" (0.3 to 0.7): some essential points, or a minor error. "incorrect" (0 to 0.2): missing the core idea or contains a significant error.
- Feedback is at most 2 sentences, warm and specific.
- Follow the feedback style requested for each item.`;

export function gradeTask(
  language: string,
  items: { id: string; question: string; modelAnswer: string; studentAnswer: string; reveal: boolean }[],
): string {
  const body = items
    .map(
      (it) => `<item id="${it.id}">
Question: ${it.question}
Model answer: ${it.modelAnswer}
Student answer: ${it.studentAnswer || "(blank)"}
Feedback style: ${
        it.reveal
          ? "explain what was missing or wrong, then state the correct answer briefly."
          : "if not fully correct, do NOT reveal the answer; name what is missing or off and ask one guiding question so the student can try again."
      }
</item>`,
    )
    .join("\n");
  return `${body}\n\nGrade every item. ${languageLine(language)}`;
}

// ---------- Long-form outputs ----------

export function guideTask(language: string, concepts: string[]): string {
  return `Task: write a complete study guide for this material, in Markdown.
Structure:
1. "# <title>" and a 2-3 sentence overview.
2. One "##" section per major topic, following the material's order. In each: the key ideas explained clearly, **bold** key terms with definitions, a worked example or concrete application wherever possible, and a short "Common mistakes" note where relevant.
3. "## Key terms": a Markdown table (Term | Definition).
4. "## Memory aids": mnemonics or analogies for the hardest ideas.
5. "## Check yourself": 8 to 12 questions mixing recall and application, then "## Answer key" with brief answers.
Cover these concepts: ${concepts.join("; ")}.
Be thorough but tight: no filler, no repetition. ${languageLine(language)}`;
}

export function summaryTask(language: string): string {
  return `Task: write a concise summary of this material, in Markdown.
Structure:
1. "## TL;DR": 3 to 5 bullets with the most important takeaways.
2. "## Key points": short sections by topic, each a few tight bullets.
3. "## Must-know terms": a bulleted list of term: one-line definition.
Aim for roughly one tenth the length of the material, at most 900 words. ${languageLine(language)}`;
}

// ---------- Podcast ----------

export const podcastSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["A", "B"] },
          text: { type: "string" },
        },
        required: ["speaker", "text"],
      },
    },
  },
  required: ["title", "lines"],
};

export interface PodcastScript {
  title: string;
  lines: { speaker: "A" | "B"; text: string }[];
}

export function podcastTask(opts: { language: string; minutes: number; hostA: string; hostB: string; focus?: string }): string {
  const words = Math.round(opts.minutes * 150);
  return `Task: write a two-host study podcast script about this material, about ${words} words in total (${opts.minutes} minutes spoken).
- Host A (${opts.hostA}) is the expert who explains; Host B (${opts.hostB}) is a sharp fellow student who asks the questions a learner would ask, makes connections, and occasionally gets something slightly wrong so A can correct it.
- Open with a one-line hook, then walk through the most important ideas in a logical order, using concrete examples and analogies. Keep it accurate to the material.
- Natural spoken language: short sentences, contractions, light humour. No stage directions, sound effects, Markdown, or LaTeX; say formulas in words.
- End with a 3-question rapid-fire recap where B asks and A answers.
${opts.focus ? `- Focus on: ${opts.focus}\n` : ""}${languageLine(opts.language)}`;
}

// ---------- Tutor ----------

export function tutorSystem(socratic: boolean, language: string): string {
  return `${SYSTEM}

You are now tutoring the student one-on-one about the material.
${
  socratic
    ? `Teach Socratically. Do not hand over answers to questions that look like homework or practice problems. Instead ask one guiding question at a time, check the student's reasoning, and give hints that get progressively more specific. When the student reaches the answer, confirm it and briefly consolidate. If the student is clearly stuck after several tries, or just wants a concept explained (not a problem solved), explain it clearly, then check understanding with a quick question.`
    : `Explain clearly and directly, with examples. After explaining, offer a quick question to check understanding.`
}
Keep replies short (under 150 words) unless the student asks for more. If a question is outside the material, say so briefly and help anyway with general knowledge, flagged as such.
${languageLine(language)}`;
}

// ---------- Ingestion (fast model) ----------

export const TRANSCRIBE_PROMPTS: Record<string, string> = {
  document: `Convert this document to clean, complete Markdown so a student can study from the text alone.
Keep every piece of content in its original order: headings, paragraphs, lists, tables (as Markdown tables), equations (LaTeX).
For each figure, chart, or diagram, add "> Figure: " followed by a description of what it shows and every label or value in it.
Do not summarise or omit anything. Output only the Markdown.`,
  image: `Transcribe this image of study material to Markdown. Include all text exactly, including handwriting (mark unclear words with [?]).
Write equations in LaTeX. For diagrams, add "> Figure: " followed by what the diagram shows, including all labels.
Output only the Markdown.`,
  audio: `Transcribe this lecture or study recording into clean Markdown notes a student can study from.
Remove filler words and false starts but keep all substantive content, examples, and anything the speaker says is important or will be on the exam.
Add "##" headings when the topic changes. Write equations in LaTeX. Output only the Markdown.`,
  video: `Turn this lecture video into clean, complete Markdown study notes.
Capture everything the speaker explains (remove filler), and everything shown on screen: slide text, board work, diagrams (described with all labels), equations (LaTeX), and code.
Add "##" headings when the topic changes, and note anything the speaker says is important or will be on the exam. Output only the Markdown.`,
  web: `Read the web page at the URL below and return its main educational content as clean Markdown.
Skip navigation, ads, comments, and other boilerplate. Keep headings, lists, tables, equations (LaTeX), and figure descriptions. Output only the Markdown.`,
};
