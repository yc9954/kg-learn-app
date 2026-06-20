"use client";

/**
 * LearnExperience — the entry surface that ties a topic input to the live graph
 * (PRD §8 step 4; AC-1/7/8). Submitting a topic POSTs `/api/research`, gets back
 * a `sessionId`, and hands it to `GraphView`, which opens the SSE stream and
 * grows the graph on screen.
 */

import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import {
  ArrowLeft,
  ArrowRight,
  FolderKanban,
  Gauge,
  GraduationCap,
  LayoutGrid,
  LogOut,
  MessagesSquare,
  Network,
  Sparkles,
} from "lucide-react";
import GraphView, { type GraphStats } from "@/components/graph/GraphView";
import LecturePanel, { type LectureProgress } from "@/components/graph/LecturePanel";
import ChatPanel from "@/components/graph/ChatPanel";
import AssessmentQuiz from "@/components/graph/AssessmentQuiz";
import ProjectsPanel, {
  type ProjectSummary,
} from "@/components/graph/ProjectsPanel";
import LecturesLibraryPanel from "@/components/graph/LecturesLibraryPanel";
import Progress from "@/components/ui/Progress";
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
  const [mode, setMode] = useState<
    "workspace" | "assessment" | "lectures" | "projects" | "library"
  >("workspace");
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

  // Open one of the user's saved projects: load it into the workspace. The
  // research stream replays the persisted graph for a known sessionId.
  function openProject(project: ProjectSummary) {
    setTopic(project.prompt || project.title);
    setSessionId(project.id);
    setProgress(null);
    setGraphStats(null);
    setAutoStartLecture(false);
    setError(null);
    setMode("workspace");
  }

  // "New project" from the projects tab: clear the workspace and focus the form.
  function newProject() {
    setTopic("");
    setSessionId(null);
    setProgress(null);
    setGraphStats(null);
    setAutoStartLecture(false);
    setError(null);
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
                <Network className={styles.featureIcon} size={18} aria-hidden />
                Live-growing prerequisite graph
              </li>
              <li className={styles.featureItem}>
                <Gauge className={styles.featureIcon} size={18} aria-hidden />
                Adaptive level assessment
              </li>
              <li className={styles.featureItem}>
                <GraduationCap className={styles.featureIcon} size={18} aria-hidden />
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
                className={`${styles.button} ${styles.googleButton}`}
                type="button"
                onClick={() => signIn("google", { callbackUrl: "/" })}
              >
                <svg className={styles.googleIcon} viewBox="0 0 24 24" width="20" height="20" aria-hidden>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Sign in with Google
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
            className={
              mode === "workspace" || mode === "assessment"
                ? styles.navItemActive
                : styles.navItem
            }
            onClick={backToGraph}
          >
            <Network className={styles.navIcon} size={18} aria-hidden />
            Graph &amp; Chat
          </button>
          <button
            type="button"
            className={
              mode === "lectures" || mode === "library"
                ? styles.navItemActive
                : styles.navItem
            }
            onClick={() => setMode("library")}
          >
            <GraduationCap className={styles.navIcon} size={18} aria-hidden />
            Lectures
          </button>
          <button
            type="button"
            className={mode === "projects" ? styles.navItemActive : styles.navItem}
            onClick={() => setMode("projects")}
          >
            <FolderKanban className={styles.navIcon} size={18} aria-hidden />
            My Projects
          </button>
          <a className={styles.navItem} href="/examples">
            <LayoutGrid className={styles.navIcon} size={18} aria-hidden />
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
            <LogOut size={15} aria-hidden /> Log out
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.pageTitle}>
            {mode === "lectures"
              ? "Lectures"
              : mode === "library"
                ? "My Lectures"
                : mode === "projects"
                  ? "My Projects"
                  : "Knowledge Graph"}
          </h1>
          <p className={styles.subtitle}>
            {mode === "library"
              ? "Every lecture you've generated — revisit your course any time."
              : mode === "projects"
                ? "Your saved research projects — reopen a graph or start a new one."
                : "Enter a topic and watch its prerequisite graph build itself, live."}
          </p>
          {mode !== "projects" && mode !== "library" && (
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
          )}
          {error && <p className={styles.error}>{error}</p>}
        </header>

        {researching &&
          mode !== "lectures" &&
          mode !== "projects" &&
          mode !== "library" && (
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

        {mode === "library" ? (
          <div className={styles.panel}>
            <LecturesLibraryPanel />
          </div>
        ) : mode === "projects" ? (
          <div className={styles.panel}>
            <ProjectsPanel onOpen={openProject} onNew={newProject} />
          </div>
        ) : mode === "lectures" ? (
          <div className={styles.panel}>
            <button type="button" className={styles.backToGraph} onClick={backToGraph}>
              <ArrowLeft size={15} aria-hidden /> Back to graph &amp; chat
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
                <span className={styles.chatTitle}>
                  <MessagesSquare size={17} aria-hidden /> Study assistant
                </span>
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

      <div className={styles.progressTrack}>
        <Progress value={pct} tone={pct >= 100 ? "success" : "primary"} />
      </div>
      <span className={styles.progressPct}>{pct}% mastered</span>

      <button
        type="button"
        className={styles.generateBtn}
        onClick={onGenerate}
        disabled={!canGenerate}
      >
        <Sparkles size={16} aria-hidden /> Generate lecture notes
        <ArrowRight size={16} aria-hidden />
      </button>
    </div>
  );
}
