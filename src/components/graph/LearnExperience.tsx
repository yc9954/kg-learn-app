"use client";

/**
 * LearnExperience — the entry surface that ties a topic input to the live graph
 * (PRD §8 step 4; AC-1/7/8). Submitting a topic POSTs `/api/research`, gets back
 * a `sessionId`, and hands it to `GraphView`, which opens the SSE stream and
 * grows the graph on screen.
 */

import { useState } from "react";
import GraphView from "@/components/graph/GraphView";
import LecturePanel, { type LectureProgress } from "@/components/graph/LecturePanel";
import styles from "./learn.module.css";

export default function LearnExperience() {
  const [topic, setTopic] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LectureProgress | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start research.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>Knowledge-Graph Learning</h1>
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

      <div className={styles.graph}>
        <GraphView
          sessionId={sessionId}
          currentId={progress?.currentNodeId ?? null}
          nextIds={progress?.nextIds}
        />
      </div>

      <LecturePanel sessionId={sessionId} onProgress={setProgress} />
    </div>
  );
}
