import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
  ThinkingLevel,
} from "@google/genai";
import { repairLatex } from "./latex";
import { repairMolTokens } from "./mol";
import { breakdown, cacheStorageCost, costOf, findModel, type UsageMetadata } from "./pricing";
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
    readonly code: "no-key" | "bad-key" | "quota" | "busy" | "blocked" | "truncated" | "bad-json" | "api" = "api",
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
  /** Keep a cut-off answer (with a note) instead of failing. For transcripts, where most is better than none. */
  allowTruncated?: boolean;
  config?: GenerateContentConfig;
  /**
   * The material held in `config.cachedContent`. A cache belongs to one model, so a stand-in model
   * (used when the configured one is overloaded) gets this inline instead. Without it, a cached
   * call can only retry its own model.
   */
  cachedMaterial?: string;
  signal?: AbortSignal;
}

function buildConfig(opts: CallOptions, thinking: Settings["smartThinking"]): GenerateContentConfig {
  const config: GenerateContentConfig = { ...opts.config, abortSignal: opts.signal };
  // With an explicit cache the system instruction lives in the cache; sending it again is a 400.
  if (opts.system && !config.cachedContent) config.systemInstruction = opts.system;
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Capacity trouble on Google's side ("This model is currently experiencing high demand",
 * "The model is overloaded"). Matched on the text too, because it doesn't always arrive as a 503.
 */
export function isOverloaded(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 429) return false;
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /high demand|overloaded|\bUNAVAILABLE\b|try again later/i.test(messageOf(err))
  );
}

/** Failures another model may not share: capacity, per-model rate limits, or a model this key can't use. */
function modelSpecific(err: unknown): boolean {
  const status = statusOf(err);
  return isOverloaded(err) || status === 429 || status === 403 || status === 404;
}

const labelOf = (model: string) => findModel(model)?.label ?? model;

function friendly(err: unknown, tried: string[] = []): Error {
  if (err instanceof GeminiError) return err;
  if (err instanceof Error && err.name === "AbortError") return err;
  const status = statusOf(err);
  const msg = messageOf(err);
  if (isOverloaded(err)) {
    const names = tried.map(labelOf);
    const which = names.length > 1 ? ` Mnemo tried ${names.slice(0, -1).join(", ")} and ${names.at(-1)}.` : "";
    return new GeminiError(
      `Google's Gemini servers are busy right now. That's on Google's side, not your key.${which} Try again in a minute.`,
      "busy",
    );
  }
  if (status === 400 && /api key/i.test(msg)) return new GeminiError("Gemini rejected the API key. Check it in Settings.", "bad-key");
  if (status === 403) return new GeminiError("This API key isn't allowed to use that model. Check the key in Settings.", "bad-key");
  if (status === 429)
    return new GeminiError(
      "Gemini rate limit hit. On the free tier this resets daily. Wait a minute and try again, or enable billing on the key.",
      "quota",
    );
  return new GeminiError(`Gemini error${status ? ` (${status})` : ""}: ${msg}`);
}

/**
 * Stand-ins for each model, same kind, best first. Each Gemini model has its own capacity pool and
 * its own free-tier quota, so when one is overloaded or rate-limited another usually isn't.
 */
const FALLBACKS: Record<string, string[]> = {
  "gemini-3.8-flash": ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  "gemini-4-argon": ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
  "gemini-3.5-flash-lite": ["gemini-3.1-flash-lite", "gemini-3.8-flash"],
  "gemini-3.1-flash-lite": ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
  "gemini-2.5-flash-lite": ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
  "gemini-3.8-flash-lite-tts": ["gemini-3.8-flash-tts"],
  "gemini-3.8-flash-tts": ["gemini-3.8-flash-lite-tts"],
};

/** After a model fails this way, later calls try the others first for a while instead of waiting on it again. */
const TROUBLE_MS = 2 * 60_000;
const troubleAt = new Map<string, number>();

/** The configured model, then its stand-ins; any that failed in the last two minutes go to the back. */
export function modelChain(primary: string, now = Date.now()): string[] {
  const chain = [primary, ...(FALLBACKS[primary] ?? []).filter((m) => m !== primary)];
  const cooling = (m: string) => now - (troubleAt.get(m) ?? -Infinity) < TROUBLE_MS;
  return [...chain.filter((m) => !cooling(m)), ...chain.filter(cooling)];
}

/** Test hook: forget which models recently failed. */
export function resetModelTrouble(): void {
  troubleAt.clear();
}

export interface Attempt {
  model: string;
  /** The model's thinking setting was rejected; send without one. */
  dropThinking: boolean;
}

const RETRY_DELAYS = [1500, 5000, 12000];
/** Pause before a second pass over the whole chain, when every model was busy or rate-limited. */
const SECOND_PASS_DELAY = 8000;

const transient = (err: unknown) => isOverloaded(err) || statusOf(err) === 429;

/**
 * Runs a call on the configured model and, when Google reports high demand, a per-model rate
 * limit, or a model this key can't use, moves on to a stand-in model. A momentary overload gets
 * one quick retry first; with no stand-in available it gets three, spaced out. If every model was
 * busy or rate-limited, it waits and goes round once more. Returns which model answered so usage
 * is priced correctly.
 */
export async function withFallback<T>(
  primary: string,
  fn: (a: Attempt) => Promise<T>,
  opts: { signal?: AbortSignal; canSwitch?: boolean; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<{ value: T; model: string }> {
  const wait = opts.sleep ?? sleep;
  const models = opts.canSwitch === false ? [primary] : modelChain(primary);
  const sameModelRetries = models.length === 1 ? RETRY_DELAYS.length : 1;
  const passes = models.length > 1 ? 2 : 1;
  const tried = new Set<string>();
  let lastErr: unknown;
  let allTransient = true;
  for (let pass = 0; pass < passes; pass++) {
    if (pass > 0) {
      if (!allTransient) break;
      await wait(SECOND_PASS_DELAY + Math.random() * 1000);
    }
    for (const model of models) {
      tried.add(model);
      let dropThinking = false;
      let retries = pass === 0 ? 0 : sameModelRetries;
      for (;;) {
        try {
          const value = await fn({ model, dropThinking });
          troubleAt.delete(model);
          if (model !== primary) console.info(`Gemini: ${primary} unavailable, answered by ${model}`);
          return { value, model };
        } catch (err) {
          if (opts.signal?.aborted) throw err;
          lastErr = err;
          const status = statusOf(err);
          if (status === 400 && !dropThinking && /thinking/i.test(messageOf(err))) {
            dropThinking = true;
            continue;
          }
          if (!modelSpecific(err)) throw friendly(err);
          if (!transient(err)) allTransient = false;
          // A rate limit with a stand-in available moves on at once; waiting wouldn't help much.
          const retrySame = (isOverloaded(err) || (status === 429 && models.length === 1)) && retries < sameModelRetries;
          if (!retrySame) {
            // Only a model we actually gave up on goes to the back of the line for later calls.
            troubleAt.set(model, Date.now());
            break;
          }
          await wait(RETRY_DELAYS[retries++] + Math.random() * 500);
        }
      }
    }
  }
  throw friendly(lastErr, [...tried]);
}

/** Retries a call that isn't tied to a model (file uploads). */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return (await withFallback("files", () => fn(), { signal, canSwitch: false })).value;
}

/** Puts the material back in front of the conversation, the way an uncached call sends it. */
export function inlineMaterial(contents: Content[] | string, material: string): Content[] {
  const part: Part = { text: `<material>\n${material}\n</material>` };
  const list: Content[] = typeof contents === "string" ? [{ role: "user", parts: [{ text: contents }] }] : contents;
  const [first, ...rest] = list;
  if (first?.role === "user") return [{ ...first, parts: [part, ...(first.parts ?? [])] }, ...rest];
  return [{ role: "user", parts: [part] }, ...list];
}

/**
 * Sends a text request through the fallback chain. On a stand-in model the explicit cache (which
 * belongs to the configured model) is dropped and the material and system instruction go inline.
 */
async function send<T>(
  opts: CallOptions,
  request: (model: string, req: { contents: Content[] | string; config: GenerateContentConfig }) => Promise<T>,
): Promise<{ value: T; model: string }> {
  const { model: primary, thinking } = modelFor(opts.role);
  const cached = !!opts.config?.cachedContent;
  const canSwitch = !cached || opts.cachedMaterial !== undefined;
  return withFallback(
    primary,
    ({ model, dropThinking }) => {
      const level = dropThinking ? "default" : thinking;
      if (cached && model !== primary) {
        const { cachedContent: _, ...config } = opts.config!;
        const uncached = { ...opts, config };
        return request(model, { contents: inlineMaterial(opts.contents, opts.cachedMaterial!), config: buildConfig(uncached, level) });
      }
      return request(model, { contents: opts.contents, config: buildConfig(opts, level) });
    },
    { signal: opts.signal, canSwitch },
  );
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
  const { value: res, model } = await send(opts, (model, req) => ai().models.generateContent({ model, ...req }));
  record(model, opts, res.usageMetadata);
  checkFinish(res);
  const text = res.text ?? "";
  if (res.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    if (!opts.allowTruncated || !text) throw new GeminiError("The answer was cut off. Try again with less material.", "truncated");
    return `${text}\n\n[Truncated: Gemini hit its output limit here. Split this source into smaller parts to get the rest.]`;
  }
  return text;
}

export async function generateJson<T>(opts: CallOptions & { schema: object }): Promise<T> {
  const { value: res, model } = await send(opts, (model, req) =>
    ai().models.generateContent({
      model,
      contents: req.contents,
      config: { ...req.config, responseMimeType: "application/json", responseJsonSchema: opts.schema },
    }),
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
    return JSON.parse(trimmed, (_key, value: unknown) => (typeof value === "string" ? repairMolTokens(repairLatex(value)) : value)) as T;
  } catch {
    throw new GeminiError("Gemini returned malformed JSON. Try again.", "bad-json");
  }
}

export async function streamText(opts: CallOptions, onText: (full: string) => void): Promise<string> {
  // Overload errors can arrive as the stream's first event rather than as the HTTP status, so the
  // first chunk is read inside the fallback: an error there moves on to a stand-in model.
  const { value: opened, model } = await send(opts, async (model, req) => {
    const stream = await ai().models.generateContentStream({ model, ...req });
    const it = stream[Symbol.asyncIterator]();
    return { it, first: await it.next() };
  });
  const { it } = opened;
  let full = "";
  let usage: UsageMetadata | undefined;
  try {
    for (let step = opened.first; !step.done; step = await it.next()) {
      const chunk = step.value;
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

export interface SpokenTurn {
  speaker: string;
  text: string;
  /** Delivery hint, e.g. "curious, upbeat". */
  style?: string;
}

/**
 * Two-speaker text-to-speech. Gemini 3.8 TTS requires every text part to name its speaker
 * via speechMetadata (the older "Name: line" text convention is rejected with a 400).
 */
export async function synthesizeDialogue(opts: {
  turns: SpokenTurn[];
  speakers: [string, string];
  voices: [string, string];
  task: string;
  kitId?: string;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  const callOpts: CallOptions = { role: "fast", task: opts.task, kitId: opts.kitId, contents: "" };
  const { value: res, model } = await withFallback(
    env.getSettings().ttsModel,
    ({ model }) =>
      ai().models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: opts.turns.map((t) => ({ text: t.text, speechMetadata: { speaker: t.speaker, style: t.style } })),
          },
        ],
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
    { signal: opts.signal },
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

// ---------- Explicit context caching ----------

export const CACHE_TTL_SEC = 3600;
/** Gemini 3.x Flash caches need at least ~4,096 tokens; below that, creation fails. */
export const CACHE_MIN_CHARS = 4500 * 4;

export interface CacheHandle {
  name: string;
  model: string;
  expiresAt: number;
  tokens: number;
}

/**
 * Stores `systemInstruction` + `material` server-side for an hour, so repeat calls pay 10% for
 * those tokens instead of 100%. Returns null when caching isn't possible (too small, model
 * doesn't support it, key not allowed), and the caller sends the material inline instead.
 */
export async function createMaterialCache(opts: {
  role: Role;
  system: string;
  material: string;
  kitId: string;
  signal?: AbortSignal;
}): Promise<CacheHandle | null> {
  if (opts.material.length < CACHE_MIN_CHARS) return null;
  const { model } = modelFor(opts.role);
  try {
    const cache = await ai().caches.create({
      model,
      config: {
        displayName: `mnemo-${opts.kitId.slice(0, 8)}`,
        systemInstruction: opts.system,
        contents: [{ role: "user", parts: [{ text: `<material>\n${opts.material}\n</material>` }] }],
        ttl: `${CACHE_TTL_SEC}s`,
        abortSignal: opts.signal,
      },
    });
    if (!cache.name) return null;
    const tokens = cache.usageMetadata?.totalTokenCount ?? Math.round(opts.material.length / 4);
    // Creation bills the tokens once at the input rate, plus storage for the TTL.
    env.onUsage({
      at: Date.now(),
      model,
      task: "cache",
      kitId: opts.kitId,
      usage: { promptTokenCount: tokens },
      costUsd: costOf(model, { promptTokenCount: tokens }) + cacheStorageCost(model, tokens, CACHE_TTL_SEC / 3600),
    });
    const expiresAt = cache.expireTime ? new Date(cache.expireTime).getTime() : Date.now() + CACHE_TTL_SEC * 1000;
    return { name: cache.name, model, expiresAt, tokens };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    console.warn("Context cache unavailable; sending material inline", err);
    return null;
  }
}

export function knownModel(id: string): boolean {
  return !!findModel(id);
}

export { breakdown };
