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
/** When synced settings last changed on this device; newer wins across devices. */
const TS_KEY = "mnemo.settings.ts";
const listeners = new Set<() => void>();
const editListeners = new Set<() => void>();
let cached: Settings | null = null;
let memTs = 0;

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

/** Device-only settings that don't sync. */
export const LOCAL_ONLY: (keyof Settings)[] = ["theme"];

function write(next: Settings) {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Storage unavailable; settings live for this tab only.
  }
  listeners.forEach((l) => l());
}

export function updateSettings(patch: Partial<Settings>): void {
  write({ ...read(), ...patch });
  if (Object.keys(patch).some((k) => !LOCAL_ONLY.includes(k as keyof Settings))) {
    setSettingsTs(Date.now());
    editListeners.forEach((l) => l());
  }
}

export function settingsTs(): number {
  try {
    return Number(localStorage.getItem(TS_KEY) ?? 0);
  } catch {
    return memTs;
  }
}

function setSettingsTs(ts: number) {
  memTs = ts;
  try {
    localStorage.setItem(TS_KEY, String(ts));
  } catch {
    // ignore
  }
}

/** Applies settings from another device without counting it as a local edit. */
export function applyRemoteSettings(values: Partial<Settings>, ts: number): void {
  const incoming = { ...values };
  for (const k of LOCAL_ONLY) delete incoming[k];
  write({ ...read(), ...incoming });
  setSettingsTs(ts);
}

/** Notified when the user changes a synced setting. */
export function onSettingsEdited(listener: () => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, read);
}
