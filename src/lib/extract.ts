// Local, free text extraction for text-based formats. Browser-only (pdf.js, DOMParser).
import JSZip from "jszip";
import type { SourceKind } from "./db";

const EXT_KIND: Record<string, SourceKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  png: "image", jpg: "image", jpeg: "image", webp: "image", heic: "image", heif: "image", gif: "image", bmp: "image",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", oga: "audio", flac: "audio", opus: "audio", weba: "audio", aiff: "audio",
  mp4: "video", mov: "video", webm: "video", mkv: "video", avi: "video", m4v: "video", mpeg: "video", mpg: "video", "3gp": "video", wmv: "video", flv: "video",
};

/** Extensions read as plain text. Anything else unknown is sniffed. */
const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "rtf", "tex", "rst", "org", "yaml", "yml", "log", "srt", "vtt",
  "py", "js", "ts", "tsx", "jsx", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php", "swift", "kt", "m", "r", "sql", "sh", "ipynb",
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function kindOf(file: File): SourceKind {
  const ext = extOf(file.name);
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  if (TEXT_EXT.has(ext)) return "text";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf") return "pdf";
  return "text";
}

/** Gemini needs a concrete mime type; browsers leave some (e.g. .m4a, .heic) blank. */
export function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = extOf(file.name);
  const guess: Record<string, string> = {
    pdf: "application/pdf", heic: "image/heic", heif: "image/heif", m4a: "audio/mp4", aac: "audio/aac",
    flac: "audio/flac", opus: "audio/ogg", mkv: "video/x-matroska", mov: "video/quicktime", m4v: "video/mp4",
  };
  return guess[ext] ?? "application/octet-stream";
}

export interface PdfText {
  text: string;
  pages: number;
  charsPerPage: number;
}

export async function pdfText(file: Blob): Promise<PdfText> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else if (item.str && !item.str.endsWith(" ")) {
        line += " ";
      }
    }
    if (line.trim()) lines.push(line);
    pages.push(`<!-- page ${n} -->\n${lines.map((l) => l.trimEnd()).join("\n")}`);
  }
  await task.destroy();
  const text = pages.join("\n\n");
  const chars = text.replace(/<!-- page \d+ -->|\s/g, "").length;
  return { text, pages: doc.numPages, charsPerPage: chars / Math.max(1, doc.numPages) };
}

export async function docxText(file: Blob): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return htmlToMarkdown(value);
}

export async function pptxText(file: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNo = (path: string) => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNo(a) - slideNo(b));
  const parser = new DOMParser();
  const paragraphs = (xml: string) =>
    Array.from(parser.parseFromString(xml, "application/xml").getElementsByTagName("a:p"))
      .map((p) =>
        Array.from(p.getElementsByTagName("a:t"))
          .map((t) => t.textContent ?? "")
          .join(""),
      )
      .filter((s) => s.trim());
  const out: string[] = [];
  for (const path of slides) {
    const n = slideNo(path);
    const body = paragraphs(await zip.file(path)!.async("string"));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    // Notes slides repeat the slide number as a lone digit; drop it.
    const notes = notesFile ? paragraphs(await notesFile.async("string")).filter((s) => s.trim() !== String(n)) : [];
    let section = `## Slide ${n}\n${body.map((l, i) => (i === 0 ? `**${l}**` : `- ${l}`)).join("\n")}`;
    if (notes.length) section += `\n\nSpeaker notes: ${notes.join(" ")}`;
    out.push(section);
  }
  return out.join("\n\n");
}

export async function plainText(file: Blob, name: string): Promise<string> {
  const text = await file.text();
  const ext = extOf(name);
  if (ext === "html" || ext === "htm") return htmlToMarkdown(text);
  if (ext === "ipynb") return notebookText(text);
  if (ext === "rtf") return text.replace(/\\par[d]?/g, "\n").replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/g, "").trim();
  return text;
}

/** True if the bytes look like a binary format we can't read as text. */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4000);
  if (!sample) return false;
  const bad = sample.match(/[\u0000-\u0008\u000e-\u001f�]/g)?.length ?? 0;
  return bad / sample.length > 0.02;
}

function notebookText(json: string): string {
  try {
    const nb = JSON.parse(json) as { cells: { cell_type: string; source: string[] | string }[] };
    return nb.cells
      .map((c) => {
        const src = Array.isArray(c.source) ? c.source.join("") : c.source;
        return c.cell_type === "code" ? "```\n" + src + "\n```" : src;
      })
      .join("\n\n");
  } catch {
    return json;
  }
}

/** Small HTML -> Markdown converter covering what study documents use. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, nav, footer, noscript").forEach((el) => el.remove());

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
    if (!(node instanceof Element)) return "";
    const inner = Array.from(node.childNodes).map(inline).join("");
    switch (node.tagName) {
      case "STRONG":
      case "B":
        return inner.trim() ? `**${inner.trim()}** ` : "";
      case "EM":
      case "I":
        return inner.trim() ? `*${inner.trim()}* ` : "";
      case "CODE":
        return `\`${inner}\``;
      case "BR":
        return "\n";
      case "SUB":
        return `_${inner}`;
      case "SUP":
        return `^${inner}`;
      default:
        return inner;
    }
  };

  const block = (el: Element, depth = 0): string[] => {
    const out: string[] = [];
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) out.push(`${"#".repeat(Number(tag[1]))} ${inline(child).trim()}`);
      else if (tag === "P") {
        const t = inline(child).trim();
        if (t) out.push(t);
      } else if (tag === "UL" || tag === "OL") {
        Array.from(child.children).forEach((li, i) => {
          const marker = tag === "OL" ? `${i + 1}.` : "-";
          const nested = Array.from(li.children).filter((c) => c.tagName === "UL" || c.tagName === "OL");
          nested.forEach((n) => n.remove());
          out.push(`${"  ".repeat(depth)}${marker} ${inline(li).trim()}`);
          nested.forEach((n) => {
            const wrapper = doc.createElement("div");
            wrapper.appendChild(n);
            out.push(...block(wrapper, depth + 1));
          });
        });
      } else if (tag === "TABLE") {
        const rows = Array.from(child.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.children).map((c) => inline(c).trim().replace(/\|/g, "\\|")),
        );
        if (rows.length) {
          const width = Math.max(...rows.map((r) => r.length));
          const fmt = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
          out.push([fmt(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(fmt)].join("\n"));
        }
      } else if (tag === "PRE") out.push("```\n" + (child.textContent ?? "") + "\n```");
      else if (tag === "BLOCKQUOTE") out.push(`> ${inline(child).trim()}`);
      else if (tag === "IMG") {
        const alt = child.getAttribute("alt");
        if (alt) out.push(`> Figure: ${alt}`);
      } else out.push(...block(child, depth));
    }
    // Text directly inside container elements (no <p>).
    const loose = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (loose && depth === 0 && !out.length) out.push(loose);
    return out;
  };

  return block(doc.body).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}
