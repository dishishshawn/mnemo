import { useSyncExternalStore } from "react";

export type ThinkingLevel = "default" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface Settings {
  apiKey: string;
  /** Generates study content: concepts, flashcards, questions, guides, podcast scripts, tutor. */
  smartModel: string;
  smartThinking: ThinkingLevel;
  /** Cheap bulk work: transcribing media, OCR, grading short answers. */
  fastModel: string;
  fastThinking: ThinkingLevel;
  ttsModel: string;
  podcastVoices: [string, string];
  podcastMinutes: number;
  theme: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  smartModel: "gemini-3.8-flash",
  smartThinking: "LOW",
  fastModel: "gemini-3.1-flash-lite",
  fastThinking: "default",
  ttsModel: "gemini-3.8-flash-lite-tts",
  podcastVoices: ["Puck", "Kore"],
  podcastMinutes: 8,
  theme: "system",
};

export const TTS_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
  "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
  "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

const KEY = "mnemo.settings";
const listeners = new Set<() => void>();
let cached: Settings | null = null;

function read(): Settings {
  if (cached) return cached;
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    // Private mode or corrupt value: fall back to defaults.
  }
  cached = { ...DEFAULT_SETTINGS, ...stored };
  return cached;
}

export function getSettings(): Settings {
  return read();
}

export function updateSettings(patch: Partial<Settings>): void {
  cached = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Storage unavailable; settings live for this tab only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, read);
}
