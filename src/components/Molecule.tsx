import clsx from "clsx";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { drawSvg, identify, rdkit } from "../lib/chem";
import { Modal } from "./ui";

type Art = { svg: string; width: number; height: number } | null;

const SCALE = { sm: 1, md: 1.35, lg: 2.4 };

/** Draws a structure token. Falls back to the name (or the SMILES) if RDKit can't load or read it. */
export function Molecule({
  smiles,
  name,
  size = "md",
  showName = false,
  zoom = false,
}: {
  smiles: string;
  name?: string;
  size?: keyof typeof SCALE;
  /** Caption it with its name. Off in questions and options, where the name could give the answer away. */
  showName?: boolean;
  /** Tap to see it large with its formula. Off inside buttons and flip cards, where a tap means something else. */
  zoom?: boolean;
}) {
  const [art, setArt] = useState<Art | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    rdkit()
      .then((R) => live && setArt(drawSvg(R, smiles)))
      .catch(() => live && setArt(null));
    return () => {
      live = false;
    };
  }, [smiles]);

  if (art === undefined) return <span className="mx-1 inline-block h-12 w-20 animate-pulse rounded-lg surface-2 align-middle" aria-label="Drawing structure" />;
  if (art === null) return <span className="font-medium">{name ?? <code className="text-xs">{smiles}</code>}</span>;

  return (
    <>
      <span
        className={clsx("mol mx-1 my-1 inline-flex max-w-full flex-col items-center align-middle", zoom && "cursor-zoom-in")}
        onClick={
          zoom
            ? (e) => {
                e.stopPropagation();
                setOpen(true);
              }
            : undefined
        }
      >
        <span
          role="img"
          // The name stays out of the label where it's hidden on screen, or a screen reader would read out the answer.
          aria-label={showName && name ? name : "Chemical structure"}
          className="block max-w-full [&>svg]:h-auto [&>svg]:w-full"
          style={{ width: art.width * SCALE[size] }}
          dangerouslySetInnerHTML={{ __html: art.svg }}
        />
        {showName && name && <span className="text-center text-[11px] leading-tight text-muted">{name}</span>}
      </span>
      {open && createPortal(<Zoomed smiles={smiles} name={name} art={art} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Zoomed({ smiles, name, art, onClose }: { smiles: string; name?: string; art: NonNullable<Art>; onClose: () => void }) {
  const [formula, setFormula] = useState("");
  useEffect(() => {
    rdkit()
      .then((R) => setFormula(identify(R, smiles)?.formula ?? ""))
      .catch(() => {});
  }, [smiles]);
  return (
    <Modal open onClose={onClose} title={name ?? "Structure"}>
      <div className="space-y-3">
        <div className="flex justify-center rounded-2xl surface-2 p-4">
          <span className="block max-w-full [&>svg]:h-auto [&>svg]:w-full" style={{ width: Math.min(art.width * SCALE.lg, 440) }} dangerouslySetInnerHTML={{ __html: art.svg }} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {formula && (
            <>
              <dt className="text-muted">Formula</dt>
              <dd className="font-medium">{formula.replace(/(\d+)/g, (d) => d.replace(/\d/g, (n) => "₀₁₂₃₄₅₆₇₈₉"[Number(n)]))}</dd>
            </>
          )}
          <dt className="text-muted">SMILES</dt>
          <dd className="break-all font-mono text-xs leading-5">{smiles}</dd>
        </dl>
        <a
          href={`https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(name ?? smiles)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
        >
          <ExternalLink className="size-4" /> Look it up on PubChem
        </a>
      </div>
    </Modal>
  );
}
