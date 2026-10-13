// Gemini API paid-tier prices, USD per 1M tokens.
// Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-10-13).
// Several models have a scheduled increase; `from` entries apply on and after that date.

export interface Rates {
  input: number;
  /** Audio input, when the model prices it separately from text/image/video. */
  audioInput?: number;
  /** Cached input (implicit or explicit context caching). */
  cachedInput: number;
  output: number;
  /** Audio output (TTS models). */
  audioOutput?: number;
}

export interface ModelPrice {
  id: string;
  label: string;
  kind: "text" | "tts";
  note?: string;
  rates: Rates;
  changes?: { from: string; rates: Rates }[];
}

export const MODELS: ModelPrice[] = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    kind: "text",
    note: "Best quality per dollar. Price doubles on 2027-01-01.",
    rates: { input: 0.75, cachedInput: 0.075, output: 3.75 },
    changes: [{ from: "2027-01-01", rates: { input: 1.5, cachedInput: 0.15, output: 7.5 } }],
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    kind: "text",
    rates: { input: 0.3, cachedInput: 0.03, output: 2.5 },
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    kind: "text",
    note: "Cheapest current model. Good for transcription and grading.",
    rates: { input: 0.25, audioInput: 0.5, cachedInput: 0.025, output: 1.5 },
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    kind: "text",
    note: "Oldest and cheapest; access is restricted on some accounts.",
    rates: { input: 0.1, audioInput: 0.3, cachedInput: 0.01, output: 0.4 },
  },
  {
    id: "gemini-4-argon",
    label: "Gemini 4 Argon",
    kind: "text",
    note: "Flagship reasoning model. ~3x the cost of Flash; rarely worth it for studying.",
    rates: { input: 2, cachedInput: 0.1, output: 10 },
    changes: [{ from: "2026-12-01", rates: { input: 4, cachedInput: 0.2, output: 20 } }],
  },
  {
    id: "gemini-3.8-flash-lite-tts",
    label: "Gemini 3.8 Flash-Lite TTS",
    kind: "tts",
    note: "About $0.09 per 10 minutes of podcast audio.",
    rates: { input: 0.5, cachedInput: 0.5, output: 6, audioOutput: 6 },
    changes: [{ from: "2027-01-01", rates: { input: 1, cachedInput: 1, output: 12, audioOutput: 12 } }],
  },
  {
    id: "gemini-3.8-flash-tts",
    label: "Gemini 3.8 Flash TTS",
    kind: "tts",
    rates: { input: 0.5, cachedInput: 0.5, output: 9, audioOutput: 9 },
    changes: [{ from: "2027-01-01", rates: { input: 1, cachedInput: 1, output: 18, audioOutput: 18 } }],
  },
];

export function findModel(id: string): ModelPrice | undefined {
  return MODELS.find((m) => m.id === id);
}

export function ratesAt(id: string, at: Date = new Date()): Rates | undefined {
  const model = findModel(id);
  if (!model) return undefined;
  let rates = model.rates;
  for (const change of model.changes ?? []) {
    if (at >= new Date(`${change.from}T00:00:00Z`)) rates = change.rates;
  }
  return rates;
}

/** The subset of Gemini's usageMetadata we price. Field names match the API response. */
export interface UsageMetadata {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  promptTokensDetails?: { modality?: string; tokenCount?: number }[];
  candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
}

export interface TokenBreakdown {
  input: number;
  audioInput: number;
  cached: number;
  output: number;
  audioOutput: number;
  thoughts: number;
}

export function breakdown(usage: UsageMetadata): TokenBreakdown {
  const prompt = (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0);
  const audioInput = sumModality(usage.promptTokensDetails, "AUDIO");
  const cached = usage.cachedContentTokenCount ?? 0;
  const candidates = usage.candidatesTokenCount ?? 0;
  const audioOutput = sumModality(usage.candidatesTokensDetails, "AUDIO");
  return {
    input: Math.max(0, prompt - audioInput - cached),
    audioInput,
    cached,
    output: Math.max(0, candidates - audioOutput),
    audioOutput,
    thoughts: usage.thoughtsTokenCount ?? 0,
  };
}

function sumModality(details: UsageMetadata["promptTokensDetails"], modality: string): number {
  return (details ?? [])
    .filter((d) => d.modality === modality)
    .reduce((n, d) => n + (d.tokenCount ?? 0), 0);
}

/** Cost in USD for one call. Unknown models are priced at 0 and flagged by the caller. */
export function costOf(modelId: string, usage: UsageMetadata, at: Date = new Date()): number {
  const r = ratesAt(modelId, at);
  if (!r) return 0;
  const t = breakdown(usage);
  const perM =
    t.input * r.input +
    t.audioInput * (r.audioInput ?? r.input) +
    t.cached * r.cachedInput +
    (t.output + t.thoughts) * r.output +
    t.audioOutput * (r.audioOutput ?? r.output);
  return perM / 1_000_000;
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
