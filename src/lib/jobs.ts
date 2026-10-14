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
  jobs.set(key, { status: "Starting", controller });
  emit();
  // A cancelled job can still settle later; only touch the registry while it's still ours.
  const mine = () => jobs.get(key)?.controller === controller;
  const report = (status: string, progress?: number) => {
    if (!mine()) return;
    jobs.set(key, { ...jobs.get(key)!, status, progress });
    emit();
  };
  fn({ signal: controller.signal, report })
    .then(() => mine() && jobs.delete(key))
    .catch((err: Error) => {
      if (!mine()) return;
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

/** Cancels every job for a kit (keys look like "<kind>:<kitId>"). */
export function cancelKitJobs(kitId: string) {
  for (const key of [...jobs.keys()]) if (key.endsWith(`:${kitId}`)) cancelJob(key);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useJob(key: string): Job | undefined {
  useSyncExternalStore(subscribe, () => version);
  return jobs.get(key);
}

/** Whether any job is still running (reloading the page would cut it off). */
export function useJobsRunning(): boolean {
  useSyncExternalStore(subscribe, () => version);
  return [...jobs.values()].some((j) => !j.done);
}

/** Test hook: read a job without subscribing. */
export const __peek = (key: string): Omit<Job, "controller"> | undefined => jobs.get(key);
