import clsx from "clsx";
import { Penguin, PenguinSays } from "../components/Penguin";
import { useLiveQuery } from "dexie-react-hooks";
import { Send, Square, Trash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../components/Markdown";
import { Button, ErrorBox, inputClass, PageHeader, Spinner, MissingKit } from "../components/ui";
import { db, newId, type Chat } from "../lib/db";
import { useKit } from "../lib/hooks";
import { tutorReply } from "../lib/study";

const STARTERS = ["Quiz me on the hardest part", "Explain the main idea simply", "What will probably be on the exam?", "Help me with a problem"];

export default function Tutor() {
  const { kitId, kit } = useKit();
  const chat = useLiveQuery(async () => (await db.chats.where("kitId").equals(kitId).first()) ?? null, [kitId]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would call as a cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length, streaming]);

  if (kit === null) return <MissingKit />;

  if (!kit || chat === undefined) return <Spinner label="Loading" />;
  const socratic = chat?.socratic ?? true;
  const messages = chat?.messages ?? [];

  // Look the chat up at write time: `chat` from render is stale by the time a reply finishes.
  const save = async (patch: Partial<Chat>) => {
    await db.transaction("rw", db.chats, async () => {
      const current = await db.chats.where("kitId").equals(kitId).first();
      if (current) await db.chats.update(current.id, { ...patch, updatedAt: Date.now() });
      else await db.chats.add({ id: newId(), kitId, socratic, messages: [], updatedAt: Date.now(), ...patch });
    });
  };

  const send = async (text: string) => {
    if (!text.trim() || streaming !== null) return;
    setInput("");
    setError("");
    const history = [...messages, { role: "user" as const, text: text.trim(), at: Date.now() }];
    await save({ messages: history });
    setStreaming("");
    abort.current = new AbortController();
    let partial = "";
    const onText = (t: string) => {
      partial = t;
      setStreaming(t);
    };
    try {
      const reply = await tutorReply(kitId, history, socratic, onText, abort.current.signal);
      await save({ messages: [...history, { role: "model", text: reply, at: Date.now() }] });
    } catch (err) {
      // Keep what arrived before Stop, so the conversation still alternates user/model.
      if (abort.current.signal.aborted) await save({ messages: [...history, { role: "model", text: partial ? `${partial} …` : "(stopped)", at: Date.now() }] });
      else setError((err as Error).message);
    } finally {
      setStreaming(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col" style={{ minHeight: "calc(100dvh - 9rem)" }}>
      <PageHeader
        title="Tutor"
        subtitle={kit.title}
        back={`/kit/${kitId}`}
        actions={
          <>
            <label className="flex items-center gap-2 rounded-xl surface px-3 py-1.5 text-sm" title="Socratic mode guides you with questions instead of giving answers">
              <input type="checkbox" className="accent-brand-700" checked={socratic} onChange={(e) => save({ socratic: e.target.checked })} />
              Socratic
            </label>
            {messages.length > 0 && streaming === null && (
              <Button variant="ghost" size="sm" onClick={() => confirm("Clear this conversation?") && save({ messages: [] })} aria-label="Clear chat">
                <Trash className="size-4" />
              </Button>
            )}
          </>
        }
      />

      <div className="flex-1 space-y-4">
        {messages.length === 0 && streaming === null && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted">
              {socratic ? "Ask anything about your material. I'll guide you to the answer with questions rather than just handing it over." : "Ask anything about your material."}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full surface px-3 py-1.5 text-sm hover:border-brand-400">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {streaming !== null && (streaming ? <Bubble role="model" text={streaming} /> : <PenguinSays mood="thinking" size="sm">Thinking…</PenguinSays>)}
        {error && <ErrorBox error={error} />}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 mt-4 flex gap-2 bg-[var(--bg)] py-3"
      >
        <textarea
          rows={1}
          className={clsx(inputClass, "max-h-40 resize-none")}
          placeholder="Ask a question or answer the tutor…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {streaming !== null ? (
          <Button type="button" variant="secondary" onClick={() => abort.current?.abort()} aria-label="Stop">
            <Square className="size-4" />
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()} aria-label="Send">
            <Send className="size-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "model"; text: string }) {
  return (
    <div className={clsx("flex items-end gap-2", role === "user" ? "justify-end" : "justify-start")}>
      {role === "model" && <Penguin mood="idle" size="sm" className="shrink-0" />}
      <div className={clsx("max-w-[85%] rounded-2xl px-4 py-2.5", role === "user" ? "bg-brand-300 text-brand-900 dark:bg-brand-500 dark:text-white" : "surface")}>
        {role === "user" ? <p className="whitespace-pre-wrap text-sm">{text}</p> : <Markdown className="text-sm prose-p:my-1.5">{text}</Markdown>}
      </div>
    </div>
  );
}
