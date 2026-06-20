import Link from "next/link";
import type { Metadata } from "next";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "About · KG Learn",
  description:
    "How the Knowledge-Graph Learning app turns any topic into a live prerequisite graph and adaptive lectures.",
};

const STEPS = [
  {
    title: "Enter a topic",
    text: "Type anything — diffusion models, Kalman filters, Byzantine consensus. Research starts immediately.",
  },
  {
    title: "Graph grows live",
    text: "A prerequisite knowledge graph builds itself on screen over a streaming connection until it converges.",
  },
  {
    title: "Level assessment",
    text: "An adaptive quiz marks the concepts you already know so lectures start at the right depth.",
  },
  {
    title: "Ordered lectures",
    text: "Lectures are generated in topological order with zero forward references — never using an un-taught concept.",
  },
];

const STACK = [
  "Next.js 16 (App Router)",
  "TypeScript",
  "GitHub Copilot SDK",
  "Azure AI Foundry",
  "Cytoscape.js",
  "NextAuth",
];

export default function AboutPage() {
  return (
    <div className={styles.shell}>
      <Link className={styles.back} href="/">
        ← Back to workspace
      </Link>

      <section className={styles.hero}>
        <span className={styles.badge}>KG Learn</span>
        <h1 className={styles.heroTitle}>
          Learn anything as a living knowledge graph.
        </h1>
        <p className={styles.heroLede}>
          KG Learn turns a single topic into a live-growing prerequisite map, then
          teaches it back to you in the right order — adapting to what you already
          know, and never referencing a concept before it has been taught.
        </p>
      </section>

      <h2 className={styles.sectionTitle}>How it works</h2>
      <div className={styles.steps}>
        {STEPS.map((step, i) => (
          <article key={step.title} className={styles.card}>
            <span className={styles.cardNum}>{i + 1}</span>
            <h3 className={styles.cardTitle}>{step.title}</h3>
            <p className={styles.cardText}>{step.text}</p>
          </article>
        ))}
      </div>

      <h2 className={styles.sectionTitle}>Built with</h2>
      <ul className={styles.stackList}>
        {STACK.map((tech) => (
          <li key={tech} className={styles.chip}>
            {tech}
          </li>
        ))}
      </ul>
    </div>
  );
}
