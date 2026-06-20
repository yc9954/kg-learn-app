"use client";

/**
 * LearnExperience — the entry surface that ties a topic input to the live graph
 * (PRD §8 step 4; AC-1/7/8). Submitting a topic POSTs `/api/research`, gets back
 * a `sessionId`, and hands it to `GraphView`, which opens the SSE stream and
 * grows the graph on screen.
 */

import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import GraphView from "@/components/graph/GraphView";
import LecturePanel, { type LectureProgress } from "@/components/graph/LecturePanel";
import styles from "./learn.module.css";

export default function LearnExperience() {
  const { data: session, status } = useSession();
  const [topic, setTopic] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LectureProgress | null>(null);
  const [activeTab, setActiveTab] = useState<"graph" | "lectures">("graph");

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || starting) return;

    setStarting(true);
    setError(null);
    setSessionId(null);
    setProgress(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `research start failed (${res.status})`);
      }
      const data = (await res.json()) as { sessionId: string };
      setSessionId(data.sessionId);
      setActiveTab("graph");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start research.");
    } finally {
      setStarting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className={styles.landingShell}>
        <div className={styles.landingCard}>
          <span className={styles.loadingDot} aria-hidden />
          <span>Loading session…</span>
        </div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className={styles.landingShell}>
        <div className={styles.landingSplit}>
          <section className={styles.brandPane} aria-hidden>
            <span className={styles.brandBadge}>KG Learn</span>
            <h1 className={styles.brandTitle}>
              Learn anything as a living knowledge graph.
            </h1>
            <p className={styles.brandLede}>
              Type a topic and watch its prerequisite map build itself — then get
              an adaptive quiz and lectures with zero forward references.
            </p>
            <ul className={styles.featureList}>
              <li className={styles.featureItem}>
                <span className={styles.featureIcon}>◆</span>
                Live-growing prerequisite graph
              </li>
              <li className={styles.featureItem}>
                <span className={styles.featureIcon}>◆</span>
                Adaptive level assessment
              </li>
              <li className={styles.featureItem}>
                <span className={styles.featureIcon}>◆</span>
                Topologically-ordered lectures
              </li>
            </ul>
          </section>

          <section className={styles.loginPane}>
            <div className={styles.landingCard}>
              <h2 className={styles.title}>Welcome back</h2>
              <p className={styles.subtitle}>
                Sign in to start building live graphs, take quizzes, and generate
                lectures.
              </p>
              <button
                className={styles.button}
                type="button"
                onClick={() => signIn(undefined, { callbackUrl: "/" })}
              >
                Log in to continue
              </button>
              <p className={styles.loginHint}>
                Your sessions and progress stay tied to your account.
              </p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <span className={styles.brandMarkBadge}>KG</span>
          <span className={styles.sidebarBrandName}>KG Learn</span>
        </div>

        <nav className={styles.sidebarNav} aria-label="Workspace">
          <button
            type="button"
            className={activeTab === "graph" ? styles.navItemActive : styles.navItem}
            onClick={() => setActiveTab("graph")}
          >
            <span className={styles.navIcon}>◈</span>
            Graph
          </button>
          <button
            type="button"
            className={activeTab === "lectures" ? styles.navItemActive : styles.navItem}
            onClick={() => setActiveTab("lectures")}
          >
            <span className={styles.navIcon}>▤</span>
            Lectures
          </button>
          <a className={styles.navItem} href="/about">
            <span className={styles.navIcon}>❖</span>
            About
          </a>
        </nav>

        <div className={styles.sidebarFooter}>
          <span className={styles.user}>
            {session.user?.email ?? session.user?.name ?? "user"}
          </span>
          <button
            className={styles.authButton}
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Log out
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.pageTitle}>
            {activeTab === "graph" ? "Knowledge Graph" : "Lectures"}
          </h1>
          <p className={styles.subtitle}>
            Enter a topic and watch its prerequisite graph build itself, live.
          </p>
          <form className={styles.form} onSubmit={start}>
            <input
              className={styles.input}
              type="text"
              value={topic}
              placeholder="e.g. Diffusion models, Kalman filters, Byzantine consensus…"
              onChange={(e) => setTopic(e.target.value)}
              aria-label="Research topic"
            />
            <button className={styles.button} type="submit" disabled={starting}>
              {starting ? "Starting…" : "Build the graph"}
            </button>
          </form>
          {error && <p className={styles.error}>{error}</p>}
        </header>

        <div className={styles.panel}>
          {activeTab === "graph" ? (
            <div className={styles.graph}>
              <GraphView
                sessionId={sessionId}
                currentId={progress?.currentNodeId ?? null}
                nextIds={progress?.nextIds}
              />
            </div>
          ) : (
            <LecturePanel sessionId={sessionId} onProgress={setProgress} />
          )}
        </div>
      </main>
    </div>
  );
}
