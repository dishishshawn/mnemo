// In-memory registry of long-running jobs (processing material, recording a podcast), so their
// progress survives navigating between pages. Jobs die with the tab; their results are in IndexedDB.
import { useSyncExternalStore } from "react";

export interface Job {
  status: string;
  progress?: number;
  error?: string;
  done?: boolean;
  controller: AbortController;
}

const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function runJob(
  key: string,
  fn: (ctx: { signal: AbortSignal; report: (status: string, progress?: number) => void }) => Promise<void>,
): void {
  if (jobs.get(key) && !jobs.get(key)!.done) return;
  const controller = new AbortController();
  const job: Job = { status: "Starting", controller };
  jobs.set(key, job);
  emit();
  const report = (status: string, progress?: number) => {
    jobs.set(key, { ...jobs.get(key)!, status, progress });
    emit();
  };
  fn({ signal: controller.signal, report })
    .then(() => jobs.delete(key))
    .catch((err: Error) => {
      if (controller.signal.aborted) jobs.delete(key);
      else jobs.set(key, { ...jobs.get(key)!, error: err.message, done: true });
    })
    .finally(emit);
}

export function cancelJob(key: string) {
  jobs.get(key)?.controller.abort();
  jobs.delete(key);
  emit();
}

export function clearJob(key: string) {
  jobs.delete(key);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useJob(key: string): Job | undefined {
  useSyncExternalStore(subscribe, () => version);
  return jobs.get(key);
}
