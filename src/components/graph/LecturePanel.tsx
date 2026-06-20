"use client";

/**
 * LecturePanel — the on-demand lecture surface (PRD §8 step 5; AC-10/11).
 *
 * "Teach me" fetches the current forward-ref-0 lecture for the topic; "Next
 * concept" marks it complete and advances through the topological path. Each
 * lecture is rendered (text + Mermaid + KaTeX) by <LectureView>. Progress
 * (current/next concepts) is surfaced upward so the graph can highlight them.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BookOpen, Loader2, RotateCcw } from "lucide-react";
import type { Lecture } from "@/lib/ontology/types";
import LectureView from "@/components/Lecture";
import styles from "./lecture.module.css";

type LectureApiResponse = {
  lecture: Lecture | null;
  done: boolean;
  path: string[];
  completed: string[];
  currentNodeId: string | null;
  attempts?: number;
  error?: string;
};

export type LectureProgress = {
  currentNodeId: string | null;
  nextIds: string[];
  completed: string[];
};

export default function LecturePanel({
  sessionId,
  onProgress,
  autoStart = false,
}: {
  sessionId: string | null;
  onProgress?: (p: LectureProgress) => void;
  /** When true, automatically fetch the first lecture once a session exists. */
  autoStart?: boolean;
}) {
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (action: "teach" | "next" | "restart") => {
      if (!sessionId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/lecture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, topicId: sessionId }),
        });
        const data = (await res.json()) as LectureApiResponse;
        if (!res.ok) throw new Error(data.error || `lecture failed (${res.status})`);

        setStarted(true);
        setLecture(data.lecture);
        setPath(data.path ?? []);
        setCompleted(data.completed ?? []);
        setCurrentNodeId(data.currentNodeId);
        setDone(data.done);

        // Upcoming concepts (the next few un-taught nodes) for graph highlight.
        const taught = new Set([...(data.completed ?? [])]);
        if (data.currentNodeId) taught.add(data.currentNodeId);
        const nextIds = (data.path ?? []).filter((id) => !taught.has(id)).slice(0, 3);
        onProgress?.({
          currentNodeId: data.currentNodeId,
          nextIds,
          completed: data.completed ?? [],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load lecture.");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, busy, onProgress],
  );

  // Auto-fetch the first lecture when triggered from the graph ("Generate
  // lecture notes" button) — no need to come here and press "Teach me".
  useEffect(() => {
    if (autoStart && sessionId && !started && !busy) {
      void call("teach");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, sessionId]);

  if (!sessionId) return null;

  const position = currentNodeId ? path.indexOf(currentNodeId) + 1 : completed.length;
  const total = path.length;

  return (
    <section className={styles.panel} aria-label="Lecture">
      <div className={styles.bar}>
        <div className={styles.meta}>
          <strong className={styles.metaTitle}>
            <BookOpen size={17} aria-hidden /> Lectures
          </strong>
          {total > 0 && (
            <span className={styles.progress}>
              {done ? `done · ${total}/${total}` : `${Math.max(position, 0)}/${total}`}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          {!started ? (
            <button className={styles.primary} onClick={() => call("teach")} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className={styles.spin} size={15} aria-hidden /> Preparing…
                </>
              ) : (
                <>
                  <BookOpen size={15} aria-hidden /> Teach me
                </>
              )}
            </button>
          ) : done ? (
            <button className={styles.ghost} onClick={() => call("restart")} disabled={busy}>
              <RotateCcw size={15} aria-hidden /> Restart
            </button>
          ) : (
            <>
              <button className={styles.ghost} onClick={() => call("restart")} disabled={busy}>
                <RotateCcw size={15} aria-hidden /> Restart
              </button>
              <button className={styles.primary} onClick={() => call("next")} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className={styles.spin} size={15} aria-hidden /> Generating…
                  </>
                ) : (
                  <>
                    Next concept <ArrowRight size={15} aria-hidden />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.body}>
        {done && !lecture ? (
          <p className={styles.complete}>
            🎉 You&apos;ve completed every concept in this path. Forward-reference 0 held the whole way.
          </p>
        ) : lecture ? (
          <LectureView lecture={lecture} />
        ) : (
          <p className={styles.hint}>
            Press <em>Teach me</em> to get the first lecture. Each one uses only concepts you already
            know or have been taught — no undefined jargon, guaranteed.
          </p>
        )}
      </div>
    </section>
  );
}
