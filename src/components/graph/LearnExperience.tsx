"use client";

/**
 * LearnExperience — the entry surface that ties a topic input to the live graph
 * (PRD §8 step 4; AC-1/7/8). Submitting a topic POSTs `/api/research`, gets back
 * a `sessionId`, and hands it to `GraphView`, which opens the SSE stream and
 * grows the graph on screen.
 */

import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import GraphView, { type GraphStats } from "@/components/graph/GraphView";
import LecturePanel, { type LectureProgress } from "@/components/graph/LecturePanel";
import ChatPanel from "@/components/graph/ChatPanel";
import AssessmentQuiz from "@/components/graph/AssessmentQuiz";
import { EXAMPLE_PROJECTS } from "@/lib/examples/projects";
import styles from "./learn.module.css";

const HOW_STEPS = [
  {
    title: "Enter a topic",
    text: "Type anything. Research starts immediately and concepts begin appearing.",
  },
  {
    title: "Graph grows live",
    text: "A prerequisite graph builds itself over a streaming connection until it converges.",
  },
  {
    title: "Level assessment",
    text: "An adaptive quiz marks what you already know so lectures start at the right depth.",
  },
  {
    title: "Ordered lectures",
    text: "Lectures generate in topological order with zero forward references.",
  },
];

export default function LearnExperience() {
  const { data: session, status } = useSession();
  const [topic, setTopic] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LectureProgress | null>(null);
  const [mode, setMode] = useState<"workspace" | "assessment" | "lectures">(
    "workspace",
  );
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [autoStartLecture, setAutoStartLecture] = useState(false);

  // "Generate lecture notes" → ALWAYS run the self-assessment quiz first.
  function generateLectureNotes() {
    if (!sessionId) return;
    setMode("assessment");
  }

  function onAssessmentComplete() {
    setAutoStartLecture(true);
    setMode("lectures");
  }

  function backToGraph() {
    setMode("workspace");
  }

  const researching =
    graphStats?.status === "researching" ||
    (!!sessionId && graphStats === null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || starting) return;

    setStarting(true);
    setError(null);
    setSessionId(null);
    setProgress(null);
    setAutoStartLecture(false);
    setMode("workspace");
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
      setMode("workspace");
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

        <section className={styles.examples}>
          <div className={styles.examplesHead}>
            <h2 className={styles.examplesTitle}>Explore example projects</h2>
            <p className={styles.examplesSub}>
              Public samples — open any of them, no login required.
            </p>
          </div>
          <div className={styles.exampleGrid}>
            {EXAMPLE_PROJECTS.map((ex) => (
              <a
                key={ex.id}
                className={styles.exampleCard}
                href={`/examples/${ex.id}`}
              >
                <span className={styles.exampleType}>Knowledge graph</span>
                <h3 className={styles.exampleCardTitle}>{ex.title}</h3>
                <p className={styles.exampleBlurb}>{ex.blurb}</p>
                <span className={styles.exampleMeta}>
                  {ex.conceptCount} concepts · {ex.edges.length} links
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className={styles.howItWorks}>
          <h2 className={styles.examplesTitle}>How it works</h2>
          <div className={styles.stepsGrid}>
            {HOW_STEPS.map((step, i) => (
              <article key={step.title} className={styles.stepCard}>
                <span className={styles.stepNum}>{i + 1}</span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepText}>{step.text}</p>
              </article>
            ))}
          </div>
        </section>
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
            className={mode === "lectures" ? styles.navItem : styles.navItemActive}
            onClick={backToGraph}
          >
            <span className={styles.navIcon}>◈</span>
            Graph &amp; Chat
          </button>
          <a className={styles.navItem} href="/examples">
            <span className={styles.navIcon}>❖</span>
            Examples
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
            {mode === "lectures" ? "Lectures" : "Knowledge Graph"}
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

        {researching && mode !== "lectures" && (
          <div className={styles.researchBanner} role="status" aria-live="polite">
            <span className={styles.researchPulse} aria-hidden />
            <span className={styles.researchText}>
              Researching <strong>{topic.trim() || "your topic"}</strong> — building
              the prerequisite graph live
            </span>
            <span className={styles.researchCount}>
              {graphStats?.total ?? 0} concepts so far
            </span>
            <span className={styles.researchDots} aria-hidden>
              <span /> <span /> <span />
            </span>
          </div>
        )}

        {mode === "lectures" ? (
          <div className={styles.panel}>
            <button type="button" className={styles.backToGraph} onClick={backToGraph}>
              ← Back to graph &amp; chat
            </button>
            <LecturePanel
              sessionId={sessionId}
              onProgress={setProgress}
              autoStart={autoStartLecture}
            />
          </div>
        ) : (
          <div className={styles.workspaceSplit}>
            <div className={styles.workspaceMain}>
              <div className={styles.workspaceGraph}>
                <GraphView
                  sessionId={sessionId}
                  currentId={progress?.currentNodeId ?? null}
                  nextIds={progress?.nextIds}
                  onStats={setGraphStats}
                />
              </div>
              <StatusCard
                topic={topic.trim()}
                stats={graphStats}
                canGenerate={!!sessionId && (graphStats?.total ?? 0) > 0}
                onGenerate={generateLectureNotes}
              />
            </div>
            <aside className={styles.workspaceChat}>
              <div className={styles.chatHeader}>
                <span className={styles.chatTitle}>✦ Study assistant</span>
                <span className={styles.chatHint}>Ask anything about your topic</span>
              </div>
              <div className={styles.chatHost}>
                <ChatPanel topic={topic.trim() || null} />
              </div>
            </aside>
          </div>
        )}
      </main>

      {mode === "assessment" && sessionId && (
        <AssessmentQuiz
          topicId={sessionId}
          topic={topic.trim()}
          onComplete={onAssessmentComplete}
          onCancel={backToGraph}
        />
      )}
    </div>
  );
}

function StatusCard({
  topic,
  stats,
  canGenerate,
  onGenerate,
}: {
  topic: string;
  stats: GraphStats | null;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  const total = stats?.total ?? 0;
  const known = stats?.known ?? 0;
  const remaining = Math.max(total - known, 0);
  const pct = total > 0 ? Math.round((known / total) * 100) : 0;
  const phase = stats?.status ?? "idle";

  const phaseLabel =
    phase === "researching"
      ? "Building graph…"
      : phase === "converged"
        ? "Graph ready"
        : phase === "stopped"
          ? "Stopped"
          : "Idle";

  return (
    <div className={styles.statusCard}>
      <div className={styles.statusHead}>
        <span className={styles.statusLabel}>Your progress</span>
        <span
          className={styles.statusPhase}
          data-phase={phase === "researching" ? "live" : "still"}
        >
          {phaseLabel}
        </span>
      </div>

      <p className={styles.statusTopic}>{topic || "No topic yet"}</p>

      <div className={styles.statRow}>
        <div className={styles.stat}>
          <span className={styles.statNum}>{total}</span>
          <span className={styles.statKey}>concepts</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{known}</span>
          <span className={styles.statKey}>known</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{remaining}</span>
          <span className={styles.statKey}>to learn</span>
        </div>
      </div>

      <div className={styles.progressTrack} aria-hidden>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.progressPct}>{pct}% mastered</span>

      <button
        type="button"
        className={styles.generateBtn}
        onClick={onGenerate}
        disabled={!canGenerate}
      >
        Generate lecture notes →
      </button>
    </div>
  );
}
