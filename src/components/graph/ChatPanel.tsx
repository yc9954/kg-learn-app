"use client";

/**
 * ChatPanel — a conversational agent surface. The learner can talk to a study
 * assistant grounded (optionally) in the current topic. Replies stream in token
 * by token over `POST /api/chat` and render as Markdown (+ KaTeX/Mermaid via the
 * shared Lecture renderer's primitives are overkill here, so we render markdown
 * lightly with ReactMarkdown).
 */

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import styles from "./chat.module.css";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Explain this topic like I'm new to it",
  "What should I learn first?",
  "Give me a worked example",
  "Quiz me with one question",
];

export default function ChatPanel({ topic }: { topic?: string | null }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    // Push an empty assistant message we stream into.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, topic: topic ?? undefined }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `chat failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "chat error";
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${msg}` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className={styles.chat}>
      <div className={styles.scroll} ref={scrollRef}>
        {empty ? (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>Talk to your study assistant</h3>
            <p className={styles.emptyText}>
              {topic
                ? `Grounded in "${topic}". Ask anything about it.`
                : "Ask anything — or start a topic to ground the conversation."}
            </p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.suggestion}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? styles.bubbleUser : styles.bubbleBot}
            >
              {m.role === "assistant" && m.content === "" ? (
                <span className={styles.typing} aria-label="Assistant is typing">
                  <span /> <span /> <span />
                </span>
              ) : (
                <div className={styles.md}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className={styles.composerInput}
          value={input}
          placeholder="Ask the study assistant…"
          onChange={(e) => setInput(e.target.value)}
          aria-label="Chat message"
          disabled={busy}
        />
        <button className={styles.composerSend} type="submit" disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
