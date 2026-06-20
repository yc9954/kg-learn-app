import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import GraphView from "@/components/graph/GraphView";
import { EXAMPLE_PROJECTS } from "@/lib/examples/projects";
import styles from "./examples.module.css";

export function generateStaticParams() {
  return EXAMPLE_PROJECTS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const ex = EXAMPLE_PROJECTS.find((p) => p.id === id);
  return {
    title: ex ? `${ex.title} · KG Learn examples` : "Example · KG Learn",
    description: ex?.blurb,
  };
}

export default async function ExamplePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ex = EXAMPLE_PROJECTS.find((p) => p.id === id);
  if (!ex) notFound();

  return (
    <div className={styles.shell}>
      <Link className={styles.back} href="/">
        ← Back to home
      </Link>

      <div className={styles.head}>
        <span className={styles.type}>Public example · knowledge graph</span>
        <h1 className={styles.title}>{ex.title}</h1>
        <p className={styles.blurb}>{ex.blurb}</p>
      </div>

      <div className={styles.graphBox}>
        <GraphView
          graph={{
            topicId: ex.id,
            nodes: ex.nodes,
            edges: ex.edges,
            status: "converged",
          }}
        />
      </div>

      <div className={styles.others}>
        <span className={styles.othersLabel}>More examples:</span>
        {EXAMPLE_PROJECTS.map((p) => (
          <Link
            key={p.id}
            href={`/examples/${p.id}`}
            className={p.id === ex.id ? styles.chipActive : styles.chip}
          >
            {p.title}
          </Link>
        ))}
      </div>

      <Link className={styles.cta} href="/">
        Build your own graph →
      </Link>
    </div>
  );
}
