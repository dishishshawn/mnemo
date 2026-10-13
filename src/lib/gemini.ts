import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
  ThinkingLevel,
} from "@google/genai";
import { breakdown, costOf, findModel, type UsageMetadata } from "./pricing";
import { getSettings, type Settings } from "./settings";

export type Role = "smart" | "fast";

export interface UsageRecord {
  at: number;
  model: string;
  task: string;
  kitId?: string;
  usage: UsageMetadata;
  costUsd: number;
}

interface Env {
  getSettings: () => Settings;
  onUsage: (record: UsageRecord) => void;
}

const env: Env = {
  getSettings,
  onUsage: () => {},
};

/** Lets the app persist usage to IndexedDB and lets scripts supply their own settings. */
export function configureGemini(patch: Partial<Env>): void {
  Object.assign(env, patch);
}

let client: { key: string; ai: GoogleGenAI } | null = null;

function ai(): GoogleGenAI {
  const key = env.getSettings().apiKey.trim();
  if (!key) throw new GeminiError("Add your Gemini API key in Settings first.", "no-key");
  if (client?.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) };
  return client.ai;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly code: "no-key" | "bad-key" | "quota" | "blocked" | "truncated" | "bad-json" | "api" = "api",
  ) {
    super(message);
  }
}

function modelFor(role: Role): { model: string; thinking: Settings["smartThinking"] } {
  const s = env.getSettings();
  return role === "smart"
    ? { model: s.smartModel, thinking: s.smartThinking }
    : { model: s.fastModel, thinking: s.fastThinking };
}

export interface CallOptions {
  role: Role;
  task: string;
  kitId?: string;
  system?: string;
  contents: Content[] | string;
  config?: GenerateContentConfig;
  signal?: AbortSignal;
}

function buildConfig(opts: CallOptions, thinking: Settings["smartThinking"]): GenerateContentConfig {
  const config: GenerateContentConfig = { ...opts.config, abortSignal: opts.signal };
  if (opts.system) config.systemInstruction = opts.system;
  if (thinking !== "default") config.thinkingConfig = { thinkingLevel: thinking as ThinkingLevel };
  return config;
}

function record(model: string, opts: CallOptions, usage: UsageMetadata | undefined) {
  if (!usage) return;
  env.onUsage({
    at: Date.now(),
    model,
    task: opts.task,
    kitId: opts.kitId,
    usage,
    costUsd: costOf(model, usage),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number };
  return e?.status ?? e?.code;
}

function friendly(err: unknown): Error {
  if (err instanceof GeminiError) return err;
  const status = statusOf(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (status === 400 && /api key/i.test(msg)) return new GeminiError("Gemini rejected the API key. Check it in Settings.", "bad-key");
  if (status === 403) return new GeminiError("This API key isn't allowed to use that model. Check the key in Settings.", "bad-key");
  if (status === 429)
    return new GeminiError(
      "Gemini rate limit hit. On the free tier this resets daily. Wait a minute and try again, or enable billing on the key.",
      "quota",
    );
  if (err instanceof Error && err.name === "AbortError") return err;
  return new GeminiError(`Gemini error${status ? ` (${status})` : ""}: ${msg}`);
}

/** Retries transient failures, and drops an unsupported thinking level instead of failing. */
async function withRetry<T>(fn: (dropThinking: boolean) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let dropThinking = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(dropThinking);
    } catch (err) {
      if (signal?.aborted) throw err;
      const status = statusOf(err);
      const msg = err instanceof Error ? err.message : "";
      if (status === 400 && !dropThinking && /thinking/i.test(msg)) {
        dropThinking = true;
        continue;
      }
      const transient = status === 429 || status === 500 || status === 503 || status === 504;
      if (!transient || attempt >= 3) throw friendly(err);
      await sleep([2000, 6000, 15000][attempt]);
    }
  }
}

function checkFinish(res: GenerateContentResponse): void {
  const cand = res.candidates?.[0];
  if (!cand) {
    const reason = res.promptFeedback?.blockReason;
    throw new GeminiError(`Gemini returned nothing${reason ? ` (blocked: ${reason})` : ""}.`, "blocked");
  }
  if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT")
    throw new GeminiError("Gemini declined this content on safety grounds.", "blocked");
}

export async function generateText(opts: CallOptions): Promise<string> {
  const { model, thinking } = modelFor(opts.role);
  const res = await withRetry(
    (drop) =>
      ai().models.generateContent({
        model,
        contents: opts.contents,
        config: buildConfig(opts, drop ? "default" : thinking),
      }),
    opts.signal,
  );
  record(model, opts, res.usageMetadata);
  checkFinish(res);
  const text = res.text ?? "";
  if (res.candidates?.[0]?.finishReason === "MAX_TOKENS" && !text)
    throw new GeminiError("The answer was cut off. Try again with less material.", "truncated");
  return text;
}

export async function generateJson<T>(opts: CallOptions & { schema: object }): Promise<T> {
  const { model, thinking } = modelFor(opts.role);
  const res = await withRetry(
    (drop) =>
      ai().models.generateContent({
        model,
        contents: opts.contents,
        config: {
          ...buildConfig(opts, drop ? "default" : thinking),
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
        },
      }),
    opts.signal,
  );
  record(model, opts, res.usageMetadata);
  checkFinish(res);
  if (res.candidates?.[0]?.finishReason === "MAX_TOKENS")
    throw new GeminiError("The answer was cut off. Try asking for fewer items.", "truncated");
  return parseJson<T>(res.text ?? "");
}

export function parseJson<T>(text: string): T {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new GeminiError("Gemini returned malformed JSON. Try again.", "bad-json");
  }
}

export async function streamText(opts: CallOptions, onText: (full: string) => void): Promise<string> {
  const { model, thinking } = modelFor(opts.role);
  const stream = await withRetry(
    (drop) =>
      ai().models.generateContentStream({
        model,
        contents: opts.contents,
        config: buildConfig(opts, drop ? "default" : thinking),
      }),
    opts.signal,
  );
  let full = "";
  let usage: UsageMetadata | undefined;
  try {
    for await (const chunk of stream) {
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const t = chunk.text;
      if (t) {
        full += t;
        onText(full);
      }
    }
  } catch (err) {
    throw friendly(err);
  } finally {
    record(model, opts, usage);
  }
  return full;
}

export interface SpeechResult {
  pcm: Uint8Array;
  sampleRate: number;
}

/** Two-speaker text-to-speech. `script` uses "Name: line" per turn. */
export async function synthesizeDialogue(opts: {
  script: string;
  speakers: [string, string];
  voices: [string, string];
  task: string;
  kitId?: string;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  const model = env.getSettings().ttsModel;
  const callOpts: CallOptions = { role: "fast", task: opts.task, kitId: opts.kitId, contents: opts.script };
  const res = await withRetry(
    () =>
      ai().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: opts.script }] }],
        config: {
          abortSignal: opts.signal,
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: opts.speakers.map((speaker, i) => ({
                speaker,
                voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voices[i] } },
              })),
            },
          },
        },
      }),
    opts.signal,
  );
  record(model, callOpts, res.usageMetadata);
  checkFinish(res);
  const inline = res.candidates?.[0]?.content?.parts?.find((p: Part) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new GeminiError("Gemini returned no audio.", "api");
  return decodeAudio(base64ToBytes(inline.data), inline.mimeType ?? "");
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Gemini TTS returns either raw 16-bit PCM ("audio/L16;rate=24000") or a WAV. Normalize to PCM. */
export function decodeAudio(bytes: Uint8Array, mime: string): SpeechResult {
  const isRiff = bytes.length > 44 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF";
  if (isRiff) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sampleRate = view.getUint32(24, true);
    // Walk chunks to find "data"; headers are usually 44 bytes but not guaranteed.
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      const size = view.getUint32(offset + 4, true);
      if (id === "data") return { pcm: bytes.subarray(offset + 8, offset + 8 + size), sampleRate };
      offset += 8 + size + (size % 2);
    }
    return { pcm: bytes.subarray(44), sampleRate };
  }
  const rate = /rate=(\d+)/.exec(mime);
  return { pcm: bytes, sampleRate: rate ? Number(rate[1]) : 24000 };
}

/** Uploads to the Gemini Files API and waits until the file can be used in a prompt. */
export async function uploadFile(blob: Blob, mimeType: string, displayName: string, signal?: AbortSignal) {
  const client = ai();
  const file = await withRetry(() => client.files.upload({ file: blob, config: { mimeType, displayName } }), signal);
  let info = file;
  const started = Date.now();
  while (info.state === "PROCESSING") {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() - started > 10 * 60_000) throw new GeminiError("Gemini took too long to process the upload.");
    await sleep(3000);
    info = await client.files.get({ name: file.name! });
  }
  if (info.state === "FAILED") throw new GeminiError(`Gemini couldn't process ${displayName}.`);
  return { uri: info.uri!, mimeType: info.mimeType ?? mimeType };
}

export function knownModel(id: string): boolean {
  return !!findModel(id);
}

export { breakdown };
