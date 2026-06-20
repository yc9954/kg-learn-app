"use client";

/**
 * LecturesLibraryPanel — the learner's "Lectures" tab. Shows every lecture the
 * signed-in user has generated, grouped by topic. Picking a topic on the left
 * renders its lectures (in prerequisite / `order` sequence) as read-only notes
 * with Mermaid + KaTeX, so learners can revisit the course they produced.
 */

import { useEffect, useMemo, useState } from "react";
import { BookOpen, GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import LectureView from "@/components/Lecture";
import type {
  LectureItem,
  LectureTopic,
} from "@/app/api/lectures/route";
import styles from "./library.module.css";

export default function LecturesLibraryPanel() {
  const [topics, setTopics] = useState<LectureTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/lectures");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { topics: LectureTopic[] };
        if (!alive) return;
        setTopics(data.topics);
        setActiveId(data.topics[0]?.id ?? null);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "Failed to load lectures.";
        setError(msg);
        toast.error("Could not load your lectures");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const active = useMemo(
    () => topics?.find((t) => t.id === activeId) ?? null,
    [topics, activeId],
  );

  if (error) {
    return (
      <div className={styles.state}>
        <p className={styles.stateText}>Couldn&apos;t load your lectures.</p>
        <p className={styles.stateSub}>{error}</p>
      </div>
    );
  }

  if (!topics) {
    return (
      <div className={styles.state}>
        <Loader2 className={styles.spin} size={22} aria-hidden />
        <p className={styles.stateText}>Loading your lectures…</p>
      </div>
    );
  }

  if (topics.length === 0) {
    return (
      <div className={styles.state}>
        <GraduationCap size={30} aria-hidden className={styles.stateIcon} />
        <p className={styles.stateText}>No lectures yet.</p>
        <p className={styles.stateSub}>
          Build a graph, take the level check, then generate lecture notes — they
          will collect here as a course you can revisit any time.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.list} aria-label="Your lecture sets">
        {topics.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === activeId ? styles.itemActive : styles.item}
            onClick={() => setActiveId(t.id)}
          >
            <span className={styles.itemTitle}>{t.title}</span>
            <span className={styles.itemMeta}>
              <BookOpen size={13} aria-hidden /> {t.lectures.length} lecture
              {t.lectures.length === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </aside>

      <div className={styles.reader}>
        {active && (
          <>
            <header className={styles.readerHead}>
              <h2 className={styles.readerTitle}>{active.title}</h2>
              <p className={styles.readerSub}>
                Taught in prerequisite order — each lecture builds only on the
                ones before it.
              </p>
            </header>
            <ol className={styles.noteList}>
              {active.lectures.map((l: LectureItem, i) => (
                <li key={l.conceptId} className={styles.noteCard}>
                  <div className={styles.noteHead}>
                    <span className={styles.noteNum}>{i + 1}</span>
                    <h3 className={styles.noteTitle}>{l.title}</h3>
                  </div>
                  <div className={styles.noteBody}>
                    <LectureView
                      lecture={{
                        id: `${active.id}-${l.conceptId}`,
                        conceptId: l.conceptId,
                        order: l.order,
                        markdown: l.markdown,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
