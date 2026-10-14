import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { Delete, Gamepad2, Layers, Lightbulb, Puzzle, Shuffle, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, Empty, LinkButton, PageHeader, Spinner, MissingKit } from "../components/ui";
import { db, newId, type Flashcard, type GameScore } from "../lib/db";
import { shuffle, useKit } from "../lib/hooks";

type Game = "match" | "builder" | "stacker";

/** Plain text for game tiles: strip Markdown/LaTeX markers. */
const plain = (s: string) => s.replace(/\$+/g, "").replace(/[*_`#>]/g, "").trim();

export default function Games() {
  const { kitId, kit } = useKit();
  const cards = useLiveQuery(() => db.flashcards.where("kitId").equals(kitId).toArray(), [kitId]);
  const scores = useLiveQuery(() => db.scores.where("kitId").equals(kitId).toArray(), [kitId]);
  const [game, setGame] = useState<Game | null>(null);

  // Games need short answers: prefer term cards, fall back to short Q&A fronts.
  const terms = useMemo(() => {
    const all = cards ?? [];
    const t = all.filter((c) => c.kind === "term" && plain(c.front).length <= 40);
    return t.length >= 6 ? t : all.filter((c) => plain(c.front).length <= 60);
  }, [cards]);

  if (kit === null) return <MissingKit />;

  if (!kit || !cards || !scores) return <Spinner label="Loading" />;

  const best = (g: Game) => {
    const s = scores.filter((x) => x.game === g).map((x) => x.score);
    if (!s.length) return undefined;
    return g === "match" ? Math.min(...s) : Math.max(...s);
  };

  const save = (g: Game, score: number) => db.scores.add({ id: newId(), kitId, game: g, score, at: Date.now() } satisfies GameScore);

  if (terms.length < 6)
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Games" subtitle={kit.title} back={`/kit/${kitId}`} />
        <Empty icon={<Gamepad2 className="size-8" />} title="Games need at least 6 flashcards">
          <LinkButton to={`/kit/${kitId}/cards`} className="mt-3">
            <Layers className="size-4" /> Go to flashcards
          </LinkButton>
        </Empty>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Games" subtitle={kit.title} back={game ? undefined : `/kit/${kitId}`} actions={game && <Button variant="secondary" size="sm" onClick={() => setGame(null)}>All games</Button>} />
      {!game && (
        <div className="grid gap-3">
          <GameTile icon={<Puzzle />} title="Definition Match" best={best("match") !== undefined ? `Best ${(best("match")! / 1000).toFixed(1)}s` : undefined} onClick={() => setGame("match")}>
            Match six terms to their definitions as fast as you can. Wrong matches cost a second.
          </GameTile>
          <GameTile icon={<Shuffle />} title="Term Builder" best={best("builder") !== undefined ? `Best ${best("builder")}/10` : undefined} onClick={() => setGame("builder")}>
            Read the definition, then rebuild the term from scrambled letters.
          </GameTile>
          <GameTile icon={<Layers />} title="Stacker" best={best("stacker") !== undefined ? `Best ${best("stacker")}` : undefined} onClick={() => setGame("stacker")}>
            Definitions keep stacking up. Clear them by picking the right term before the stack hits the top.
          </GameTile>
        </div>
      )}
      {game === "match" && <Match cards={terms} onFinish={(ms) => save("match", ms)} best={best("match")} />}
      {game === "builder" && <Builder cards={terms} onFinish={(n) => save("builder", n)} />}
      {game === "stacker" && <Stacker cards={terms} onFinish={(n) => save("stacker", n)} best={best("stacker")} />}
    </div>
  );
}

function GameTile({ icon, title, best, onClick, children }: { icon: ReactNode; title: string; best?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/50 dark:text-brand-200 [&>svg]:size-6">{icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2 font-semibold">
            {title}
            {best && (
              <Badge tone="amber">
                <Trophy className="size-3" /> {best}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted">{children}</p>
        </div>
      </Card>
    </button>
  );
}

// ---------- Definition Match ----------

interface Tile {
  key: string;
  cardId: string;
  text: string;
  side: "term" | "def";
}

function Match({ cards, onFinish, best }: { cards: Flashcard[]; onFinish: (ms: number) => void; best?: number }) {
  const deal = useCallback(() => {
    const pick = shuffle(cards).slice(0, 6);
    return shuffle(
      pick.flatMap((c) => [
        { key: `${c.id}-t`, cardId: c.id, text: plain(c.front), side: "term" as const },
        { key: `${c.id}-d`, cardId: c.id, text: plain(c.back), side: "def" as const },
      ]),
    );
  }, [cards]);
  const [tiles, setTiles] = useState<Tile[]>(deal);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Tile | null>(null);
  const [wrong, setWrong] = useState<string[]>([]);
  const [start, setStart] = useState(() => Date.now());
  const [penalty, setPenalty] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    if (result !== null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [result]);

  const tap = (tile: Tile) => {
    if (cleared.has(tile.cardId) || result !== null) return;
    if (!selected || selected.side === tile.side) return setSelected(tile);
    if (selected.cardId === tile.cardId) {
      const next = new Set(cleared).add(tile.cardId);
      setCleared(next);
      setSelected(null);
      if (next.size === tiles.length / 2) {
        const ms = Date.now() - start + penalty;
        setResult(ms);
        onFinish(ms);
      }
    } else {
      setWrong([selected.key, tile.key]);
      setPenalty((p) => p + 1000);
      setSelected(null);
      setTimeout(() => setWrong([]), 400);
    }
  };

  const restart = () => {
    setTiles(deal());
    setCleared(new Set());
    setSelected(null);
    setPenalty(0);
    setStart(Date.now());
    setResult(null);
  };

  const elapsed = (result ?? now - start + penalty) / 1000;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-semibold tabular-nums">{elapsed.toFixed(1)}s</span>
        {penalty > 0 && <span className="text-rose-600">+{penalty / 1000}s penalty</span>}
      </div>
      {result !== null ? (
        <Card className="space-y-3 p-8 text-center">
          <Trophy className="mx-auto size-10 text-amber-500" />
          <div className="text-2xl font-bold">{(result / 1000).toFixed(1)}s</div>
          {best !== undefined && result <= best && <Badge tone="amber">New best!</Badge>}
          <Button onClick={restart}>Play again</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map((t) => (
            <button
              key={t.key}
              onClick={() => tap(t)}
              className={clsx(
                "min-h-24 rounded-xl border p-3 text-left text-sm transition",
                cleared.has(t.cardId) && "pointer-events-none scale-95 opacity-0",
                selected?.key === t.key && "border-brand-500 bg-brand-50 dark:bg-brand-950/40",
                wrong.includes(t.key) && "animate-shake border-blush-500 bg-blush-100 dark:bg-blush-700/25",
                t.side === "term" ? "font-semibold" : "text-xs leading-snug",
                selected?.key !== t.key && !wrong.includes(t.key) && "surface hover:border-brand-400",
              )}
            >
              <span className="line-clamp-5">{t.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Term Builder ----------

const ROUNDS = 10;

function Builder({ cards, onFinish }: { cards: Flashcard[]; onFinish: (n: number) => void }) {
  const [deck] = useState(() => shuffle(cards.filter((c) => plain(c.front).length <= 24)).slice(0, ROUNDS));
  const [round, setRound] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [built, setBuilt] = useState<number[]>([]);
  const [hints, setHints] = useState(0);
  const [status, setStatus] = useState<"playing" | "right" | "skipped">("playing");
  const card = deck[round];
  const target = card ? plain(card.front) : "";
  const letters = useMemo(() => [...target].map((ch, i) => ({ ch, i })).filter((x) => x.ch !== " "), [target]);
  const order = useMemo(() => shuffle(letters.map((l) => l.i)), [letters]);
  const done = round >= deck.length;

  // Positions in the target string that take letters (spaces are pre-filled).
  const slots = letters.map((l) => l.i);
  const typed = built.map((i) => target[i]).join("");
  const goal = letters.map((l) => l.ch).join("");

  useEffect(() => {
    if (status !== "playing" || typed.length !== goal.length) return;
    if (typed.toLowerCase() === goal.toLowerCase()) {
      setStatus("right");
      setCorrect((c) => c + (hints === 0 ? 1 : 0.5));
    }
  }, [typed, goal, status, hints]);

  const next = () => {
    const n = round + 1;
    setRound(n);
    setBuilt([]);
    setHints(0);
    setStatus("playing");
    if (n >= deck.length) onFinish(correct);
  };

  const hint = () => {
    // Fill the next correct letter.
    const nextChar = goal[built.length];
    const idx = order.find((i) => !built.includes(i) && target[i].toLowerCase() === nextChar.toLowerCase());
    if (idx !== undefined) {
      setBuilt((b) => [...b, idx]);
      setHints((h) => h + 1);
    }
  };

  if (!deck.length)
    return (
      <Card className="p-8 text-center text-sm text-muted">
        Term Builder needs flashcards with short terms (24 letters or fewer). Add a few in Flashcards.
      </Card>
    );

  if (done)
    return (
      <Card className="space-y-3 p-8 text-center">
        <Trophy className="mx-auto size-10 text-amber-500" />
        <div className="text-2xl font-bold">
          {correct}/{deck.length}
        </div>
        <p className="text-sm text-muted">Hinted words count half.</p>
      </Card>
    );

  let slotIdx = 0;
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted">
        Word {round + 1} of {deck.length} · Score {correct}
      </div>
      <Card className="p-5 text-center text-lg">{plain(card.back)}</Card>
      <div className="flex flex-wrap justify-center gap-1.5">
        {[...target].map((ch, i) => {
          if (ch === " ") return <span key={i} className="w-4" />;
          const filled = built[slotIdx++];
          return (
            <span
              key={i}
              className={clsx(
                "flex size-9 items-center justify-center rounded-lg border-b-2 text-lg font-bold uppercase",
                status === "right" ? "border-emerald-500 text-emerald-600" : status === "skipped" ? "border-rose-400 text-rose-500" : "border-brand-400",
              )}
            >
              {status === "skipped" ? ch : filled !== undefined ? target[filled] : ""}
            </span>
          );
        })}
      </div>
      {status === "playing" ? (
        <>
          <div className="flex flex-wrap justify-center gap-2">
            {order.map((i) => (
              <button
                key={i}
                disabled={built.includes(i)}
                onClick={() => built.length < slots.length && setBuilt((b) => [...b, i])}
                className="size-11 rounded-xl surface text-lg font-bold uppercase shadow-sm transition active:scale-90 disabled:opacity-20"
              >
                {target[i]}
              </button>
            ))}
          </div>
          {typed.length === goal.length && typed.toLowerCase() !== goal.toLowerCase() && <p className="text-center text-sm text-rose-600">Not quite. Backspace and try again.</p>}
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setBuilt((b) => b.slice(0, -1))}>
              <Delete className="size-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={hint}>
              <Lightbulb className="size-4" /> Hint
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStatus("skipped")}>
              Reveal
            </Button>
          </div>
        </>
      ) : (
        <Button className="w-full" onClick={next}>
          {round + 1 >= deck.length ? "Finish" : "Next word"}
        </Button>
      )}
    </div>
  );
}

// ---------- Stacker ----------

const MAX_STACK = 6;

function Stacker({ cards, onFinish, best }: { cards: Flashcard[]; onFinish: (n: number) => void; best?: number }) {
  const [stack, setStack] = useState<Flashcard[]>([]);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [started, setStarted] = useState(false);
  const [flash, setFlash] = useState<"right" | "wrong" | null>(null);
  const bag = useRef<Flashcard[]>([]);
  const speed = useRef(7000);

  const draw = useCallback(() => {
    if (!bag.current.length) bag.current = shuffle(cards);
    return bag.current.pop()!;
  }, [cards]);

  // Draw outside the state updater: StrictMode runs updaters twice, which would eat two cards.
  const push = useCallback(() => {
    const card = draw();
    setStack((s) => [...s, card]);
  }, [draw]);

  useEffect(() => {
    if (started && stack.length >= MAX_STACK) setOver(true);
  }, [started, stack.length]);

  useEffect(() => {
    if (!started || over) return;
    const t = setTimeout(push, speed.current);
    return () => clearTimeout(t);
  }, [started, over, stack, push]);

  useEffect(() => {
    if (over) onFinish(score);
    // Only when the game ends.
  }, [over]);

  const active = stack[0];
  const options = useMemo(() => {
    if (!active) return [];
    const others = shuffle(cards.filter((c) => c.id !== active.id && plain(c.front) !== plain(active.front))).slice(0, 3);
    return shuffle([active, ...others]);
  }, [active, cards]);

  const begin = () => {
    bag.current = shuffle(cards);
    speed.current = 7000;
    setStack([draw(), draw()]);
    setScore(0);
    setOver(false);
    setStarted(true);
  };

  const answer = (c: Flashcard) => {
    if (!active || over) return;
    if (c.id === active.id || plain(c.front) === plain(active.front)) {
      setScore((s) => s + 1);
      speed.current = Math.max(2500, speed.current * 0.94);
      setStack((s) => s.slice(1));
      setFlash("right");
    } else {
      push();
      setFlash("wrong");
    }
    setTimeout(() => setFlash(null), 250);
  };

  if (!started || over)
    return (
      <Card className="space-y-3 p-8 text-center">
        {over ? (
          <>
            <Trophy className="mx-auto size-10 text-amber-500" />
            <div className="text-2xl font-bold">{score} cleared</div>
            {best !== undefined && score >= best && score > 0 && <Badge tone="amber">New best!</Badge>}
          </>
        ) : (
          <p className="text-sm text-muted">A new definition lands every few seconds, faster as you go. Wrong answers add a block. Six blocks and it's over.</p>
        )}
        <Button onClick={begin}>{over ? "Play again" : "Start"}</Button>
      </Card>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">Cleared: {score}</span>
        <span className="text-muted">
          Stack {stack.length}/{MAX_STACK}
        </span>
      </div>
      <div className={clsx("flex min-h-80 flex-col-reverse gap-1.5 rounded-2xl surface-2 p-2 transition", flash === "wrong" && "animate-shake bg-rose-100 dark:bg-rose-950/40")}>
        {stack.map((c, i) => (
          <div
            key={`${c.id}-${i}`}
            className={clsx(
              "animate-pop rounded-xl px-3 py-2.5 text-sm",
              i === 0 ? "bg-brand-700 font-medium text-white shadow-md" : "surface text-muted",
              i >= MAX_STACK - 2 && i !== 0 && "border-rose-300",
            )}
          >
            <span className={i === 0 ? "" : "line-clamp-1"}>{plain(c.back)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button key={o.id} onClick={() => answer(o)} className="rounded-xl surface p-3 text-sm font-semibold transition hover:border-brand-400 active:scale-95">
            {plain(o.front)}
          </button>
        ))}
      </div>
    </div>
  );
}
