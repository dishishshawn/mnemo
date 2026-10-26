import clsx from "clsx";
import type { Figure } from "../lib/db";
import { useImageUrl } from "../lib/hooks";

/**
 * A diagram with its labels covered. The `target` label is the one being asked; the others stay
 * covered too, so the neighbouring labels can't give it away. Revealed, the target shows through.
 */
export function FigureView({ figure, target, revealed, className }: { figure: Figure; target: number; revealed: boolean; className?: string }) {
  const url = useImageUrl(figure.image);
  if (!url) return <div className={clsx("h-48 w-full animate-pulse rounded-xl surface-2", className)} />;
  return (
    <div className={clsx("relative inline-block max-w-full overflow-hidden rounded-xl bg-white", className)}>
      <img src={url} alt={figure.title} className="block max-h-[52dvh] max-w-full" draggable={false} />
      {figure.labels.map((l, i) => {
        // Wider than Gemini's box, which is often a letter short, so the ends of the word don't peek out.
        const [x, y, w, h] = l.box;
        const padX = 0.012 + w * 0.08;
        const padY = 0.01;
        const style = { left: `${(x - padX) * 100}%`, top: `${(y - padY) * 100}%`, width: `${(w + 2 * padX) * 100}%`, height: `${(h + 2 * padY) * 100}%` };
        if (i === target && revealed) return <div key={i} style={style} className="absolute rounded-sm ring-2 ring-emerald-500" />;
        return (
          <div
            key={i}
            style={style}
            className={clsx(
              "absolute flex items-center justify-center rounded-sm text-xs font-bold",
              i === target ? "bg-brand-500 text-white ring-2 ring-brand-700" : "bg-butter-200 ring-1 ring-butter-500/40",
            )}
          >
            {i === target && "?"}
          </div>
        );
      })}
    </div>
  );
}
