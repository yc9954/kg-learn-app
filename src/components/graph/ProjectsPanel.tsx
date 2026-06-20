"use client";

/**
 * ProjectsPanel — the learner's "My Projects" view. Lists every research
 * project (Topic) the signed-in user has started, with live-ish stats, and lets
 * them re-open one (replays its persisted graph in the workspace) or delete it.
 */

import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen,
  Loader2,
  Network,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import styles from "./projects.module.css";

export type ProjectSummary = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  concepts: number;
  edges: number;
  lectures: number;
  mastered: number;
};

function statusLabel(status: string): string {
  switch (status) {
    case "researching":
      return "Building";
    case "converged":
      return "Ready";
    case "stopped":
      return "Stopped";
    default:
      return "Idle";
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default function ProjectsPanel({
  onOpen,
  onNew,
}: {
  onOpen: (project: ProjectSummary) => void;
  onNew: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = (await res.json()) as {
        projects?: ProjectSummary[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
      setProjects(data.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load projects.");
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(p: ProjectSummary) {
    if (deleting) return;
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    setDeleting(p.id);
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(p.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `delete failed (${res.status})`);
      }
      setProjects((cur) => (cur ?? []).filter((x) => x.id !== p.id));
      toast.success("Project deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setDeleting(null);
    }
  }

  if (projects === null) {
    return (
      <div className={styles.loading}>
        <Loader2 className={styles.spin} size={20} aria-hidden />
        <span>Loading your projects…</span>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
        <button type="button" className={styles.newBtn} onClick={onNew}>
          <Plus size={15} aria-hidden /> New project
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {projects.length === 0 ? (
        <div className={styles.empty}>
          <FolderOpen size={36} aria-hidden />
          <p className={styles.emptyTitle}>No projects yet</p>
          <p className={styles.emptySub}>
            Start a topic and it will be saved here so you can come back to its
            graph and lectures anytime.
          </p>
          <button type="button" className={styles.newBtn} onClick={onNew}>
            <Plus size={15} aria-hidden /> Start your first project
          </button>
        </div>
      ) : (
        <ul className={styles.grid}>
          {projects.map((p) => (
            <li key={p.id} className={styles.card}>
              <button
                type="button"
                className={styles.cardOpen}
                onClick={() => onOpen(p)}
                aria-label={`Open ${p.title}`}
              >
                <span
                  className={styles.statusPill}
                  data-status={p.status}
                >
                  {statusLabel(p.status)}
                </span>
                <h3 className={styles.cardTitle}>{p.title}</h3>
                <p className={styles.cardPrompt}>{p.prompt}</p>
                <div className={styles.cardStats}>
                  <span className={styles.stat}>
                    <Network size={13} aria-hidden /> {p.concepts} concepts
                  </span>
                  <span className={styles.stat}>{p.edges} links</span>
                  <span className={styles.stat}>{p.mastered} mastered</span>
                </div>
                <span className={styles.cardTime}>
                  Updated {timeAgo(p.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => remove(p)}
                disabled={deleting === p.id}
                aria-label={`Delete ${p.title}`}
                title="Delete project"
              >
                {deleting === p.id ? (
                  <Loader2 className={styles.spin} size={15} aria-hidden />
                ) : (
                  <Trash2 size={15} aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
