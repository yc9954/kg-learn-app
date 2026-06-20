import "server-only";
import Link from "next/link";
import { ArrowLeft, Crown, GraduationCap, Medal, Trophy } from "lucide-react";
import { prisma } from "@/lib/db";
import styles from "./leaderboard.module.css";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  topics: number;
  concepts: number;
  mastered: number;
  assessments: number;
  score: number;
};

function lenOf(json: unknown): number {
  return Array.isArray(json) ? json.length : 0;
}

function displayName(email: string | null, name: string | null): string {
  if (name && name.trim()) return name.trim();
  if (email) return email.split("@")[0];
  return "anonymous";
}

async function loadRows(): Promise<Row[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      assessments: { select: { id: true } },
      progress: { select: { completed: true } },
      topics: {
        select: {
          _count: { select: { concepts: true } },
        },
      },
    },
  });

  const rows: Row[] = users.map((u) => {
    const topics = u.topics.length;
    const concepts = u.topics.reduce((s, t) => s + t._count.concepts, 0);
    const mastered = u.progress.reduce((s, p) => s + lenOf(p.completed), 0);
    const assessments = u.assessments.length;
    const score = mastered * 10 + topics * 15 + assessments * 5 + concepts;
    return {
      id: u.id,
      name: displayName(u.email, u.name),
      topics,
      concepts,
      mastered,
      assessments,
      score,
    };
  });

  return rows
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return <Crown className={styles.rankGold} size={20} aria-label="1st" />;
  if (rank === 2)
    return <Medal className={styles.rankSilver} size={20} aria-label="2nd" />;
  if (rank === 3)
    return <Medal className={styles.rankBronze} size={20} aria-label="3rd" />;
  return <span className={styles.rankNum}>{rank}</span>;
}

export default async function LeaderboardPage() {
  const rows = await loadRows();

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <Link className={styles.back} href="/">
          <ArrowLeft size={15} aria-hidden /> Back to app
        </Link>
        <div className={styles.titleRow}>
          <Trophy className={styles.titleIcon} size={28} aria-hidden />
          <h1 className={styles.title}>Leaderboard</h1>
        </div>
        <p className={styles.sub}>
          Public ranking by learning activity — concepts mastered, topics
          explored, and level checks taken. Everyone can see this board.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <GraduationCap size={36} aria-hidden />
          <p>No learners on the board yet.</p>
          <p className={styles.emptySub}>
            Build a graph, take a level check, and complete lectures to earn your
            spot.
          </p>
          <Link className={styles.cta} href="/">
            Start learning →
          </Link>
        </div>
      ) : (
        <ol className={styles.board}>
          <li className={styles.rowHead} aria-hidden>
            <span className={styles.colRank}>#</span>
            <span className={styles.colName}>Learner</span>
            <span className={styles.colStat}>Mastered</span>
            <span className={styles.colStat}>Topics</span>
            <span className={styles.colStat}>Concepts</span>
            <span className={styles.colStat}>Checks</span>
            <span className={styles.colScore}>Score</span>
          </li>
          {rows.map((r, i) => (
            <li
              key={r.id}
              className={i < 3 ? styles.rowTop : styles.row}
              data-rank={i + 1}
            >
              <span className={styles.colRank}>
                <RankBadge rank={i + 1} />
              </span>
              <span className={styles.colName}>
                <span className={styles.avatar} aria-hidden>
                  {r.name.charAt(0).toUpperCase()}
                </span>
                {r.name}
              </span>
              <span className={styles.colStat}>{r.mastered}</span>
              <span className={styles.colStat}>{r.topics}</span>
              <span className={styles.colStat}>{r.concepts}</span>
              <span className={styles.colStat}>{r.assessments}</span>
              <span className={styles.colScore}>{r.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
