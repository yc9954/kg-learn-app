import Link from "next/link";
import type { Metadata } from "next";
import { EXAMPLE_PROJECTS } from "@/lib/examples/projects";
import styles from "./index.module.css";

export const metadata: Metadata = {
  title: "Examples · KG Learn",
  description:
    "Public example knowledge graphs — open any of them, no login required.",
};

export default function ExamplesIndexPage() {
  return (
    <div className={styles.shell}>
      <Link className={styles.back} href="/">
        ← Back to home
      </Link>

      <div className={styles.head}>
        <span className={styles.type}>Public examples</span>
        <h1 className={styles.title}>Example knowledge graphs</h1>
        <p className={styles.blurb}>
          Hand-curated prerequisite graphs with ordered lecture notes. Open any
          of them — no login required.
        </p>
      </div>

      <div className={styles.grid}>
        {EXAMPLE_PROJECTS.map((ex) => (
          <Link key={ex.id} href={`/examples/${ex.id}`} className={styles.card}>
            <span className={styles.cardType}>Knowledge graph</span>
            <h2 className={styles.cardTitle}>{ex.title}</h2>
            <p className={styles.cardBlurb}>{ex.blurb}</p>
            <span className={styles.cardMeta}>
              {ex.conceptCount} concepts · {ex.edges.length} links ·{" "}
              {ex.notes.length} notes
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
