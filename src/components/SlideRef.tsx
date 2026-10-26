import { useLiveQuery } from "dexie-react-hooks";
import { Presentation } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { db, type Question } from "../lib/db";
import { useImageUrl } from "../lib/hooks";
import { findSlide } from "../lib/pages";
import { Modal } from "./ui";

/**
 * The slide a question came from, when this device kept the kit's pages (pages.ts). Shown straight
 * away after a miss, and behind a link otherwise. Tap it to see it full size.
 */
export function SlideRef({ kitId, question, open }: { kitId: string; question: Question; open: boolean }) {
  const match = useLiveQuery(async () => (await findSlide(kitId, question)) ?? null, [kitId, question.id]);
  const [shown, setShown] = useState(open);
  const [big, setBig] = useState(false);
  const page = useLiveQuery(async () => (shown && match ? ((await db.pages.get(match.id)) ?? null) : null), [shown, match?.id]);
  const url = useImageUrl(page?.image);

  if (!match) return null;
  const caption = `${match.sourceName.replace(/\.pdf$/i, "").replace(/[+_]+/g, " ")}, page ${match.page}`;
  if (!shown)
    return (
      <button onClick={() => setShown(true)} className="flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]">
        <Presentation className="size-3.5" /> Show the slide this is from
      </button>
    );
  return (
    <figure className="overflow-hidden rounded-xl border border-theme">
      <button onClick={() => setBig(true)} className="block w-full cursor-zoom-in bg-white" aria-label="Show the slide full size">
        {url ? <img src={url} alt={`Slide: ${caption}`} className="max-h-72 w-full object-contain" /> : <div className="h-40 animate-pulse surface-2" />}
      </button>
      <figcaption className="flex items-center gap-1.5 border-t border-theme px-3 py-1.5 text-xs text-muted">
        <Presentation className="size-3.5 shrink-0" /> From {caption}
      </figcaption>
      {big &&
        url &&
        createPortal(
          <Modal open onClose={() => setBig(false)} title={caption} wide>
            <img src={url} alt={`Slide: ${caption}`} className="w-full rounded-lg bg-white" />
          </Modal>,
          document.body,
        )}
    </figure>
  );
}
