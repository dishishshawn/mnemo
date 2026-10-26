import clsx from "clsx";
import { useMemo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
// Registers \ce{…} and \pu{…} on the same KaTeX instance rehype-katex uses; without it every
// chemical equation shows as red source.
import "katex/contrib/mhchem";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { repairLatex } from "../lib/latex";
import { hasMol, replaceMols, type MolToken } from "../lib/mol";
import { Molecule } from "./Molecule";

// Gemini has invented `\triple` for a triple bond; it means `\equiv`.
const rehypePlugins: Options["rehypePlugins"] = [[rehypeKatex, { macros: { "\\triple": "\\equiv" } }]];

/** Marks a structure token's stand-in. Invisible, and never in real text. */
const MOL = "⁣mol:";

/**
 * SMILES would be mangled as Markdown ("[C@@H](C)" reads as a link), so tokens are swapped for
 * inline code before parsing, which Markdown leaves alone, and drawn when that code is rendered.
 */
function useMolMarkdown(text: string, mol: { size: "sm" | "md"; showName: boolean; zoom: boolean }) {
  return useMemo(() => {
    const source = repairLatex(text);
    if (!hasMol(source)) return { source, components: undefined };
    const mols: MolToken[] = [];
    const replaced = replaceMols(source, (t) => {
      mols.push(t);
      return `\`${MOL}${mols.length - 1}\``;
    });
    const components: Components = {
      code({ children, className, node: _node, ...rest }) {
        const s = String(children);
        if (s.startsWith(MOL)) {
          const t = mols[Number(s.slice(MOL.length))];
          if (t) return <Molecule smiles={t.smiles} name={t.name} size={mol.size} showName={mol.showName} zoom={mol.zoom} />;
        }
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      },
    };
    return { source: replaced, components };
  }, [text, mol.size, mol.showName, mol.zoom]);
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const { source, components } = useMolMarkdown(children, { size: "sm", showName: true, zoom: true });
  return (
    <div
      className={clsx(
        "prose prose-slate max-w-none dark:prose-invert prose-headings:tracking-tight prose-a:text-brand-600 prose-table:text-sm prose-th:text-left",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={rehypePlugins} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

/**
 * For short strings (questions, options) where block-level prose styling would be too much.
 * Structures are drawn without their names, which could give an answer away.
 */
export function InlineMarkdown({
  children,
  className,
  molZoom = false,
  molNames = false,
}: {
  children: string;
  className?: string;
  /** Tap a structure to enlarge it. */
  molZoom?: boolean;
  /** Caption structures with their names (reference sheets, not questions). */
  molNames?: boolean;
}) {
  const { source, components } = useMolMarkdown(children, { size: "md", showName: molNames, zoom: molZoom });
  return (
    <div className={clsx("prose prose-slate max-w-none dark:prose-invert prose-p:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={rehypePlugins} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
