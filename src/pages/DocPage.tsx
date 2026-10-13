import { useLiveQuery } from "dexie-react-hooks";
import { Download, Printer, RefreshCw, ScrollText } from "lucide-react";
import { Markdown } from "../components/Markdown";
import { Button, Card, Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { db } from "../lib/db";
import { download, slug, useKit } from "../lib/hooks";
import { runJob, useJob } from "../lib/jobs";
import { generateDocument } from "../lib/study";

const COPY = {
  guide: { title: "Study guide", empty: "A complete guide: explanations, key terms, worked examples, memory aids and a self-check.", cost: "about $0.02–0.06" },
  summary: { title: "Summary", empty: "The essentials of your material on one page.", cost: "about $0.01–0.03" },
};

export default function DocPage({ type }: { type: "guide" | "summary" }) {
  const { kitId, kit } = useKit();
  const docs = useLiveQuery(() => db.outputs.where("[kitId+type]").equals([kitId, type]).reverse().sortBy("createdAt"), [kitId, type]);
  const job = useJob(`${type}:${kitId}`);
  const latest = docs?.[0];
  const busy = !!job && !job.done;

  const generate = () =>
    runJob(`${type}:${kitId}`, async ({ signal, report }) => {
      report(type === "guide" ? "Writing your study guide" : "Writing your summary");
      const old = await db.outputs.where("[kitId+type]").equals([kitId, type]).primaryKeys();
      await generateDocument(kitId, type, signal);
      await db.outputs.bulkDelete(old);
    });

  if (!kit || !docs) return <Spinner label="Loading" />;
  const copy = COPY[type];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={copy.title}
        subtitle={kit.title}
        back={`/kit/${kitId}`}
        actions={
          latest && (
            <>
              <Button variant="secondary" size="sm" onClick={() => download(new Blob([latest.content], { type: "text/markdown" }), `${slug(kit.title)}-${type}.md`)}>
                <Download className="size-4" /> .md
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
      {busy && (
        <Card className="mb-4 p-5">
          <Spinner label={`${job.status}… this takes 20–60 seconds.`} />
        </Card>
      )}
      {latest ? (
        <Card className="p-5 sm:p-8">
          <Markdown>{latest.content}</Markdown>
        </Card>
      ) : (
        !busy && (
          <Empty icon={<ScrollText className="size-8" />} title={`No ${copy.title.toLowerCase()} yet`}>
            {copy.empty}
            <div className="mt-4">
              <Button onClick={generate}>Write it ({copy.cost})</Button>
            </div>
          </Empty>
        )
      )}
    </div>
  );
}
