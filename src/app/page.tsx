import LearnExperience from "@/components/graph/LearnExperience";

/**
 * Home — the live knowledge-graph experience (PRD §8 step 4; AC-1/7/8).
 * Enter a topic → research starts → the prerequisite DAG grows on screen.
 * `LearnExperience` is a Client Component (it owns the SSE stream + Cytoscape).
 */
export default function Home() {
  return <LearnExperience />;
}
