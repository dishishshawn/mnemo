import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db, type Source } from "../lib/db";
import { extOf } from "../lib/extract";
import { runJob, useJob } from "../lib/jobs";
import { matchPicked, retryMode, retrySources } from "../lib/study";

/**
 * Retrying sources that failed to read. Links and files kept on this device go straight back in;
 * any other file (it failed on another device, or was too big to keep) is picked again first.
 * Render `picker` once on the page.
 */
export function useRetrySources(kitId: string) {
  const sources = useLiveQuery(() => db.sources.where("kitId").equals(kitId).toArray(), [kitId]);
  const kept = useLiveQuery(async () => new Set(await db.sourceFiles.where("kitId").equals(kitId).primaryKeys()), [kitId]);
  const job = useJob(`kit:${kitId}`);
  const input = useRef<HTMLInputElement>(null);
  const waiting = useRef<{ direct: Source[]; pick: Source[] }>({ direct: [], pick: [] });
  const [notice, setNotice] = useState("");

  const modeOf = (s: Source) => retryMode(s, kept ?? new Set());
  const failed = (sources ?? []).filter((s) => modeOf(s));

  const start = (retries: { id: string; file?: File }[]) =>
    runJob(`kit:${kitId}`, ({ signal, report }) =>
      retrySources(kitId, retries, (name, status) => report(`${status}${name === "kit" ? "" : `: ${name}`}`), signal),
    );

  /** Retries these sources (every failed one by default), asking for any file that wasn't kept. */
  const retry = (targets: Source[] = failed) => {
    setNotice("");
    const direct = targets.filter((s) => modeOf(s) === "retry");
    const pick = targets.filter((s) => modeOf(s) === "pick");
    if (!pick.length) return start(direct.map((s) => ({ id: s.id })));
    waiting.current = { direct, pick };
    const el = input.current!;
    el.multiple = pick.length > 1;
    el.accept = [...new Set(pick.map((s) => extOf(s.name)).filter(Boolean))].map((e) => `.${e}`).join(",");
    el.value = "";
    el.click();
  };

  const picked = (files: File[]) => {
    if (!files.length) return;
    const { direct, pick } = waiting.current;
    const matched = matchPicked(pick, files);
    const used = new Set(matched.values());
    const strays = files.filter((f) => !used.has(f)).map((f) => f.name);
    if (strays.length) setNotice(`${strays.join(", ")} didn't match a file that failed, so ${strays.length > 1 ? "they weren't" : "it wasn't"} added. Use Add material for new files.`);
    const retries = [...direct.map((s) => ({ id: s.id })), ...[...matched].map(([id, file]) => ({ id, file }))];
    if (retries.length) start(retries);
  };

  const picker = <input ref={input} type="file" className="hidden" onChange={(e) => picked([...(e.target.files ?? [])])} />;
  return { failed, modeOf, retry, picker, notice, busy: !!job && !job.done };
}
