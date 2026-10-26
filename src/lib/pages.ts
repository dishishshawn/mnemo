// Page images. When a PDF or a photo is read, each page is also kept on this device as a JPEG, so a
// missed question can show the slide it came from and diagram cards can be cut out of it
// (figures.ts). They aren't synced: a semester of slides is hundreds of megabytes.

import { db, type PageImage, type Question, type Source, type SourceKind } from "./db";
import { molsAsText } from "./mol";

const MAX_SIDE = 1600;
const QUALITY = 0.75;
/** Longer PDFs are textbooks rather than slides; their first pages are kept. */
const MAX_PAGES = 150;

export async function jpegOf(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new Error("Couldn't encode the page image.");
  return blob.arrayBuffer();
}

async function pdfPages(kitId: string, sourceId: string, file: Blob, onPage?: (n: number, of: number) => void): Promise<PageImage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const out: PageImage[] = [];
  try {
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n++) {
      onPage?.(n, count);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, MAX_SIDE / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      out.push({ id: `${sourceId}:${n}`, kitId, sourceId, page: n, image: await jpegOf(canvas), width: canvas.width, height: canvas.height });
      canvas.width = canvas.height = 0; // Safari holds on to canvas memory otherwise
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}

async function photoPage(kitId: string, sourceId: string, file: Blob): Promise<PageImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = await jpegOf(canvas);
  return { id: `${sourceId}:1`, kitId, sourceId, page: 1, image, width: canvas.width, height: canvas.height };
}

/** Keeps the pages of a PDF or photo source. Best effort: a page that won't render is skipped, never failing the read. */
export async function savePageImages(kitId: string, sourceId: string, file: Blob, kind: SourceKind, onStatus?: (s: string) => void): Promise<number> {
  if (kind !== "pdf" && kind !== "image") return 0;
  try {
    const pages =
      kind === "pdf"
        ? await pdfPages(kitId, sourceId, file, (n, of) => n % 10 === 1 && onStatus?.(`Keeping the slides (${n} of ${of})`))
        : [await photoPage(kitId, sourceId, file)];
    if (!(await db.sources.get(sourceId))) return 0; // removed while it was rendering
    await db.pages.bulkPut(pages);
    return pages.length;
  } catch (err) {
    console.warn("Couldn't keep the page images", err);
    return 0;
  }
}

/** A source's text by page, from the <!-- page N --> markers the readers write. A photo is all page 1. */
export function pageTexts(source: Pick<Source, "text" | "kind">): Map<number, string> {
  const out = new Map<number, string>();
  if (source.kind === "image") return out.set(1, source.text);
  const parts = source.text.split(/<!--\s*page\s+(\d+)\s*-->/);
  for (let i = 1; i < parts.length; i += 2) out.set(Number(parts[i]), (out.get(Number(parts[i])) ?? "") + parts[i + 1]);
  return out;
}

const STOP = new Set(
  "about above after again against also among another because been before being below between both cannot could does doing down during each every from further have having here into itself just more most much must only other over same should since some such than that their them then there these they this those through under until very were what when where which while whom whose will with within without would your yours".split(" "),
);

/** Content words, plurals folded ("cells" finds "cell", "colonies" finds "colony"). */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of molsAsText(text).toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{3,}/gu) ?? []) {
    if (STOP.has(raw)) continue;
    out.add(raw.endsWith("ies") ? `${raw.slice(0, -3)}y` : raw.endsWith("ss") ? raw : raw.replace(/s$/, ""));
  }
  return out;
}

export interface PageMatch {
  id: string;
  sourceName: string;
  page: number;
}

/**
 * The page a question most likely comes from: the one sharing the most distinctive words with the
 * question, its answer and its explanation (each shared word weighted by how few pages use it).
 * Needs at least three shared words, so a question about something no slide covers gets nothing.
 */
export function bestPage(question: string, pages: { id: string; words: Set<string> }[]): string | undefined {
  const q = words(question);
  const df = new Map<string, number>();
  for (const p of pages) for (const w of p.words) if (q.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  let best: { id: string; score: number } | undefined;
  for (const p of pages) {
    let score = 0;
    let shared = 0;
    for (const w of q)
      if (p.words.has(w)) {
        shared++;
        score += Math.log(1 + pages.length / df.get(w)!);
      }
    if (shared >= 3 && (!best || score > best.score)) best = { id: p.id, score };
  }
  return best?.id;
}

const indexCache = new Map<string, { sig: string; pages: (PageMatch & { words: Set<string> })[] }>();

/** The slide on this device that a question came from, if there is one. */
export async function findSlide(kitId: string, question: Question): Promise<PageMatch | undefined> {
  const ids = (await db.pages.where("kitId").equals(kitId).primaryKeys()) as string[];
  if (!ids.length) return undefined;
  const sig = ids.length + ":" + ids[0] + ":" + ids.at(-1);
  let index = indexCache.get(kitId);
  if (index?.sig !== sig) {
    const have = new Set(ids);
    const sources = await db.sources.where("kitId").equals(kitId).toArray();
    const pages: (PageMatch & { words: Set<string> })[] = [];
    for (const s of sources)
      for (const [page, text] of pageTexts(s)) {
        const id = `${s.id}:${page}`;
        if (have.has(id)) pages.push({ id, sourceName: s.name, page, words: words(text) });
      }
    index = { sig, pages };
    indexCache.set(kitId, index);
  }
  const answer = question.options[question.answerIndex] ?? "";
  const id = bestPage(`${question.prompt} ${answer} ${question.answer} ${question.explanation}`, index.pages);
  const hit = index.pages.find((p) => p.id === id);
  return hit && { id: hit.id, sourceName: hit.sourceName, page: hit.page };
}
