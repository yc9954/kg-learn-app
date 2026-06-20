"use client";

/**
 * AssessmentQuiz — the mandatory self-assessment gate that runs BEFORE lecture
 * notes are generated (PRD §8 step 3). It asks the learner a short adaptive
 * quiz so lectures start at the right depth and skip what they already know.
 *
 * Flow (all via POST /api/assessment, discriminated by `action`):
 *   start  → first question
 *   answer → next question (adaptive) until { done: true }
 *   submit → { userLevel } → onComplete()
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import type { AssessmentQuestion, UserLevel } from "@/lib/ontology/types";
import Progress from "@/components/ui/Progress";
import styles from "./assessment.module.css";

type StepResponse = {
  done: boolean;
  question: AssessmentQuestion | null;
  index?: number;
  total?: number;
  error?: string;
};

export default function AssessmentQuiz({
  topicId,
  topic,
  onComplete,
  onCancel,
}: {
  topicId: string;
  topic: string;
  onComplete: (level: UserLevel | null) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState<AssessmentQuestion | null>(null);
  const [answered, setAnswered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/assessment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, topicId }),
      });
      const data = (await res.json()) as StepResponse & { userLevel?: UserLevel };
      if (!res.ok) throw new Error(data.error || `assessment failed (${res.status})`);
      return data;
    },
    [topicId],
  );

  const begin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await post({ action: "start" });
      if (data.done || !data.question) {
        // No questions (tiny graph): finalize straight away.
        await finish();
        return;
      }
      setQuestion(data.question);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the quiz.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/assessment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit", topicId }),
      });
      const data = (await res.json()) as { userLevel?: UserLevel; error?: string };
      if (!res.ok) throw new Error(data.error || `submit failed (${res.status})`);
      onComplete(data.userLevel ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not score the quiz.");
      setSubmitting(false);
    }
  }

  async function choose(index: number) {
    if (busy || submitting || !question) return;
    setBusy(true);
    setError(null);
    const qid = question.id;
    try {
      const data = await post({ action: "answer", questionId: qid, answer: index });
      setAnswered((n) => n + 1);
      if (data.done || !data.question) {
        await finish();
        return;
      }
      setQuestion(data.question);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the answer.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.card} aria-label="Level check">
          <div className={styles.head}>
            <div>
              <span className={styles.kicker}>Quick level check</span>
              <Dialog.Title className={styles.title}>
                Before your lectures on {topic || "this topic"}
              </Dialog.Title>
              <Dialog.Description className={styles.sub}>
                A few quick questions so your lectures start at the right depth and
                skip what you already know. This is required before notes are built.
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.close} aria-label="Cancel">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>

          <div className={styles.progressWrap}>
            <Progress value={Math.min((answered / 5) * 100, 100)} />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          {submitting ? (
            <div className={styles.loading}>
              <Loader2 className={styles.spinner} size={20} aria-hidden />
              <span>Scoring your answers and tailoring the lectures…</span>
            </div>
          ) : question ? (
            <div className={styles.qBlock}>
              <div className={styles.qMeta}>
                <span className={styles.qNum}>Question {answered + 1}</span>
                <span className={styles.diff} data-diff={question.difficulty}>
                  {question.difficulty}
                </span>
              </div>
              <p className={styles.qText}>{question.text}</p>
              <div className={styles.options}>
                {question.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    className={styles.option}
                    disabled={busy}
                    onClick={() => choose(i)}
                  >
                    <span className={styles.optLetter}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.loading}>
              <Loader2 className={styles.spinner} size={20} aria-hidden />
              <span>Preparing your level check…</span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
