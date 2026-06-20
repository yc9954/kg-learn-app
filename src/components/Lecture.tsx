"use client";

/**
 * Lecture renderer (PRD §8 step 5; AC-11) — renders a generated lecture's
 * Markdown as text + Mermaid diagrams + KaTeX math.
 *
 *   - react-markdown + remark-gfm  → GitHub-flavored Markdown.
 *   - remark-math + rehype-katex   → $...$ inline and $$...$$ display math.
 *   - a Mermaid render pass         → ```mermaid fenced blocks become diagrams.
 *
 * Mermaid renders only on the client (it needs the DOM); fenced ```mermaid code
 * is intercepted at the <pre> boundary and handed to <MermaidBlock>.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { Lecture } from "@/lib/ontology/types";

/** Render one Mermaid diagram from its source text. */
function MermaidBlock({ chart }: { chart: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
        const { svg } = await mermaid.render(`mermaid-${reactId}`, chart);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  if (failed) {
    // Fall back to showing the diagram source rather than breaking the lecture.
    return (
      <pre className="lecture-mermaid-fallback">
        <code>{chart}</code>
      </pre>
    );
  }
  return (
    <div
      ref={ref}
      className="lecture-mermaid"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

type CodeLikeProps = { className?: string; children?: ReactNode };

/** Extract the raw text from a markdown code element's children. */
function codeText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeText).join("");
  return "";
}

export default function LectureView({ lecture }: { lecture: Lecture }) {
  return (
    <article className="lecture" data-concept-id={lecture.conceptId}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Intercept fenced ```mermaid blocks at the <pre> boundary.
          pre({ children }) {
            const child = Array.isArray(children) ? children[0] : children;
            const props =
              child && typeof child === "object" && "props" in child
                ? ((child as { props: CodeLikeProps }).props ?? {})
                : {};
            const cls = props.className ?? "";
            if (typeof cls === "string" && cls.includes("language-mermaid")) {
              return <MermaidBlock chart={codeText(props.children).replace(/\n$/, "")} />;
            }
            return <pre>{children}</pre>;
          },
        }}
      >
        {lecture.markdown}
      </ReactMarkdown>
    </article>
  );
}
