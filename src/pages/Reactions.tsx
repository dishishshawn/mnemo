import { useLiveQuery } from "dexie-react-hooks";
import { FlaskConical, Layers, Lightbulb, Printer, RefreshCw } from "lucide-react";
import { useState } from "react";
import { InlineMarkdown } from "../components/Markdown";
import { Badge, Button, Card, Empty, ErrorBox, MissingKit, PageHeader, Spinner } from "../components/ui";
import { db } from "../lib/db";
import { useKit } from "../lib/hooks";
import { runJob, useJob } from "../lib/jobs";
import type { ReactionSheet } from "../lib/prompts";
import { generateReactionSheet, reactionCards, type Reaction } from "../lib/study";

/** Every reaction in an organic chemistry kit on one sheet, drawn, and turned into cards on request. */
export default function Reactions() {
  const { kitId, kit } = useKit();
  const sheets = useLiveQuery(() => db.outputs.where("[kitId+type]").equals([kitId, "reactions"]).reverse().sortBy("createdAt"), [kitId]);
  const job = useJob(`reactions:${kitId}`);
  const [made, setMade] = useState<number | null>(null);
  const latest = sheets?.[0];
  const busy = !!job && !job.done;
  const reactions = latest ? (JSON.parse(latest.content) as ReactionSheet).reactions : [];

  const generate = () =>
    runJob(`reactions:${kitId}`, async ({ signal, report }) => {
      report("Collecting the reactions and drawing them");
      const old = await db.outputs.where("[kitId+type]").equals([kitId, "reactions"]).primaryKeys();
      await generateReactionSheet(kitId, signal);
      await db.outputs.bulkDelete(old);
    });

  if (kit === null) return <MissingKit />;
  if (!kit || !sheets) return <Spinner label="Loading" />;

  // In the material's order of concepts, reactions grouped under each.
  const groups: { concept: string; items: Reaction[] }[] = [];
  for (const r of reactions) {
    const g = groups.find((x) => x.concept === r.concept);
    if (g) g.items.push(r);
    else groups.push({ concept: r.concept, items: [r] });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Reaction sheet"
        subtitle={`${kit.title}${reactions.length ? ` · ${reactions.length} reactions` : ""}`}
        back={`/kit/${kitId}`}
        actions={
          latest && (
            <>
              <Button variant="secondary" size="sm" onClick={async () => setMade(await reactionCards(kitId, reactions))}>
                <Layers className="size-4" /> Make flashcards
              </Button>
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                <Printer className="size-4" /> Print / PDF
              </Button>
              <Button variant="secondary" size="sm" onClick={generate} loading={busy}>
                <RefreshCw className="size-4" /> Rewrite
              </Button>
            </>
          )
        }
      />
      {job?.error && <ErrorBox error={job.error} onRetry={generate} />}
      {made !== null && (
        <Card className="mb-4 p-3 text-sm">
          {made ? `Added ${made} cards to Flashcards: what each reaction makes, and which reagents do it.` : "Those cards are already in your deck."}
        </Card>
      )}
      {busy && (
        <Card className="mb-4 p-5">
          <Spinner label={`${job.status}… this takes 30–90 seconds.`} />
        </Card>
      )}

      {!latest && !busy && (
        <Empty icon={<FlaskConical className="size-8" />} title="No reaction sheet yet">
          <p>Every reaction in your material on one page: the starting material and product drawn, reagents, regiochemistry, stereochemistry, mechanism, and the catch. Each structure is checked against its name.</p>
          <Button onClick={generate} className="mt-3">
            <FlaskConical className="size-4" /> Make the sheet
          </Button>
          <p className="mt-2 text-xs">About $0.02–0.06.</p>
        </Empty>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.concept}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g.concept}</h2>
            <div className="space-y-3">
              {g.items.map((r, i) => (
                <Card key={i} className="space-y-3 p-4 break-inside-avoid">
                  <h3 className="font-semibold">{r.name}</h3>
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                    <InlineMarkdown className="text-sm" molNames molZoom>
                      {r.substrate}
                    </InlineMarkdown>
                    <div className="flex min-w-24 flex-col items-center px-1 text-center">
                      <InlineMarkdown className="text-xs leading-tight">{r.reagents}</InlineMarkdown>
                      <span className="text-2xl leading-none text-muted" aria-hidden>
                        ⟶
                      </span>
                    </div>
                    <InlineMarkdown className="text-sm" molNames molZoom>
                      {r.product}
                    </InlineMarkdown>
                  </div>
                  {(r.regiochemistry || r.stereochemistry || r.mechanism) && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.regiochemistry && <Badge tone="brand">{r.regiochemistry}</Badge>}
                      {r.stereochemistry && <Badge tone="green">{r.stereochemistry}</Badge>}
                      {r.mechanism && <Badge>{r.mechanism}</Badge>}
                    </div>
                  )}
                  {r.notes && (
                    <div className="flex gap-2 rounded-xl bg-butter-100 p-2.5 text-sm text-butter-800 dark:bg-butter-800/30 dark:text-butter-200">
                      <Lightbulb className="mt-0.5 size-4 shrink-0" />
                      <InlineMarkdown>{r.notes}</InlineMarkdown>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
