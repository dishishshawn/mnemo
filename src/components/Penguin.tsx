// The study buddy. Ten still poses swapped by mood, with a little CSS motion on top (bob, sway,
// bounce, wobble). No API calls: the images are in public/penguin/ and the animations are in
// index.css, which also honours prefers-reduced-motion.
//
// Easter eggs: tap him and he blushes and makes a finger heart; tap him five times quickly and,
// well, he's only a penguin.
import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type Mood = "idle" | "thinking" | "reading" | "cheer" | "oops" | "idea" | "listening" | "sleeping" | "love" | "toot";

const SIZES = { xs: "size-8", sm: "size-12", md: "size-20", lg: "size-28", xl: "size-40" } as const;

const EGG_MS = 1800;
const TAPS_FOR_TOOT = 5;
const TAP_WINDOW_MS = 2500;

export function Penguin({ mood = "idle", size = "md", className }: { mood?: Mood; size?: keyof typeof SIZES; className?: string }) {
  const [egg, setEgg] = useState<"love" | "toot" | null>(null);
  const taps = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const poke = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < TAP_WINDOW_MS), now];
    const next = taps.current.length >= TAPS_FOR_TOOT ? "toot" : "love";
    if (next === "toot") taps.current = [];
    setEgg(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setEgg(null), EGG_MS);
  };

  const shown: Mood = egg ?? mood;
  return (
    <span className={clsx("relative inline-block", SIZES[size], className)} onClick={poke} role="presentation">
      <img
        key={shown}
        src={`${import.meta.env.BASE_URL}penguin/${shown}.png`}
        alt=""
        draggable={false}
        className={clsx("size-full cursor-pointer select-none", `penguin-${shown}`)}
      />
      {egg === "love" && (
        <span className="pointer-events-none absolute -top-1 right-0 text-blush-500" aria-hidden>
          <span className="heart-float absolute">♥</span>
          <span className="heart-float absolute text-xs" style={{ animationDelay: "0.25s", left: "-0.6em" }}>♥</span>
          <span className="heart-float absolute text-xs" style={{ animationDelay: "0.5s", left: "0.5em" }}>♥</span>
        </span>
      )}
    </span>
  );
}

/** The penguin with a speech bubble beside him. */
export function PenguinSays({ mood, children, size = "md", className }: { mood?: Mood; children: ReactNode; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <Penguin mood={mood} size={size} className="shrink-0" />
      <div className="relative rounded-2xl surface px-3.5 py-2 text-sm leading-snug shadow-sm shadow-brand-900/5">
        <span className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rotate-45 border-b-[1.5px] border-l-[1.5px] border-theme bg-[var(--surface)]" aria-hidden />
        {children}
      </div>
    </div>
  );
}
