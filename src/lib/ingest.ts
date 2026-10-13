// Turns any supported input into Markdown text, once. Everything else reads the stored text,
// so expensive media (video, audio) is only ever sent to Gemini a single time.
import { MediaResolution, type Part } from "@google/genai";
import type { SourceKind } from "./db";
import { blobToBase64, docxText, looksBinary, mimeOf, pdfText, plainText, pptxText } from "./extract";
import { generateText, uploadFile, type Role } from "./gemini";
import { TRANSCRIBE_PROMPTS } from "./prompts";
import { getSettings } from "./settings";

/** Above this, use the Files API. Base64 inflates by 4/3 and the whole inline request must stay under ~20 MB. */
const INLINE_LIMIT = 14 * 1024 * 1024;
/** Text PDFs with fewer extractable characters per page than this are probably scans. */
const SCANNED_PDF_CHARS_PER_PAGE = 200;

export interface IngestResult {
  text: string;
  via: string;
}

export interface IngestOptions {
  kitId: string;
  /** Force Gemini to read a PDF even when it has a text layer (better for diagrams). */
  deepRead?: boolean;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export async function ingestFile(file: File, kind: SourceKind, opts: IngestOptions): Promise<IngestResult> {
  switch (kind) {
    case "text": {
      const text = await plainText(file, file.name);
      if (looksBinary(text)) throw new Error(`Can't read ${file.name}. Try exporting it as PDF.`);
      return { text, via: "local" };
    }
    case "docx":
      return { text: await docxText(file), via: "local" };
    case "pptx": {
      const text = await pptxText(file);
      if (text.replace(/## Slide \d+|\s/g, "").length < 50)
        throw new Error(`${file.name} has almost no text (slides may be images). Export it as PDF and upload that instead.`);
      return { text, via: "local" };
    }
    case "pdf": {
      if (!opts.deepRead) {
        opts.onStatus?.("Reading PDF text");
        const pdf = await pdfText(file);
        if (pdf.charsPerPage >= SCANNED_PDF_CHARS_PER_PAGE) return { text: pdf.text, via: "local" };
      }
      opts.onStatus?.("Reading PDF with Gemini");
      return transcribe(file, "document", "smart", opts);
    }
    case "image":
      opts.onStatus?.("Reading image with Gemini");
      return transcribe(file, "image", "smart", opts);
    case "audio":
      return transcribe(file, "audio", "fast", opts);
    case "video":
      return transcribe(file, "video", "fast", opts);
    default:
      throw new Error(`Unsupported source: ${kind}`);
  }
}

async function mediaPart(file: File, opts: IngestOptions): Promise<Part> {
  const mime = mimeOf(file);
  if (file.size <= INLINE_LIMIT) return { inlineData: { data: await blobToBase64(file), mimeType: mime } };
  opts.onStatus?.(`Uploading ${(file.size / 1024 / 1024).toFixed(0)} MB to Gemini`);
  const { uri, mimeType } = await uploadFile(file, mime, file.name, opts.signal);
  return { fileData: { fileUri: uri, mimeType } };
}

async function transcribe(
  file: File,
  promptKey: "document" | "image" | "audio" | "video",
  role: Role,
  opts: IngestOptions,
): Promise<IngestResult> {
  const part = await mediaPart(file, opts);
  if (promptKey === "audio" || promptKey === "video") opts.onStatus?.(`Transcribing ${promptKey} with Gemini`);
  const text = await generateText({
    role,
    task: `ingest:${promptKey}`,
    kitId: opts.kitId,
    signal: opts.signal,
    contents: [{ role: "user", parts: [part, { text: TRANSCRIBE_PROMPTS[promptKey] }] }],
    allowTruncated: true,
    // Lecture video doesn't need high-res frames; low resolution cuts video tokens by ~3x.
    config: promptKey === "video" ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : undefined,
  });
  return { text: stripFence(text), via: modelName(role) };
}

export async function ingestYouTube(url: string, opts: IngestOptions): Promise<IngestResult> {
  opts.onStatus?.("Watching the video with Gemini");
  const text = await generateText({
    role: "fast",
    task: "ingest:youtube",
    kitId: opts.kitId,
    signal: opts.signal,
    contents: [{ role: "user", parts: [{ fileData: { fileUri: url } }, { text: TRANSCRIBE_PROMPTS.video }] }],
    allowTruncated: true,
    config: { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW },
  });
  return { text: stripFence(text), via: modelName("fast") };
}

export async function ingestWebPage(url: string, opts: IngestOptions): Promise<IngestResult> {
  opts.onStatus?.("Reading the page with Gemini");
  const text = await generateText({
    role: "fast",
    task: "ingest:web",
    kitId: opts.kitId,
    signal: opts.signal,
    contents: `${TRANSCRIBE_PROMPTS.web}\n\nURL: ${url}`,
    allowTruncated: true,
    config: { tools: [{ urlContext: {} }] },
  });
  return { text: stripFence(text), via: modelName("fast") };
}

function modelName(role: Role): string {
  const s = getSettings();
  return role === "smart" ? s.smartModel : s.fastModel;
}

/** Models sometimes wrap a whole Markdown answer in a ```markdown fence. */
export function stripFence(text: string): string {
  const m = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return (m ? m[1] : text).trim();
}
