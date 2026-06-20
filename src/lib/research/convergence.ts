/**
 * Convergence + safety budget (PRD §8 step 2, AC-3).
 *
 * Research stops when EITHER:
 *   (a) the new-concept growth rate over the last K rounds falls below a
 *       threshold (default: < 1 new core concept per round for 2 rounds) → the
 *       graph has CONVERGED, or
 *   (b) a safety budget cap is hit first (max concepts / sources / tokens /
 *       wall-clock) → research is STOPPED to prevent runaway cost.
 *
 * Whichever triggers first ends research and sets the terminal `GraphStatus`
 * (`converged` or `stopped`). This module is pure/stateful-by-instance and has
 * no I/O, so it is trivially unit-testable offline on synthetic rounds.
 */

import type { GraphStatus } from "@/lib/ontology/types";

/** The safety budget cap + convergence tuning for a research run. */
export type ResearchBudget = {
  /** Hard cap on total concepts in the graph. */
  maxConcepts: number;
  /** Hard cap on total sources fetched across the run. */
  maxSources: number;
  /** Hard cap on estimated model tokens consumed. */
  maxTokens: number;
  /** Hard cap on wall-clock duration in milliseconds. */
  maxWallClockMs: number;
  /** Stop when new-concept count per round stays below this for `patience` rounds. */
  minNewConceptsPerRound: number;
  /** How many consecutive low-growth rounds before declaring convergence. */
  patience: number;
  /** Safety ceiling on the number of research rounds. */
  maxRounds: number;
};

/** Sensible defaults (PRD §8/§9): converge fast, never run away on cost. */
export const DEFAULT_BUDGET: ResearchBudget = {
  maxConcepts: 60,
  maxSources: 80,
  maxTokens: 400_000,
  maxWallClockMs: 5 * 60_000, // 5 minutes
  minNewConceptsPerRound: 1, // < 1 new concept/round ...
  patience: 2, // ... for 2 consecutive rounds → converged
  maxRounds: 12,
};

/** Why research ended (or `null` while still running). */
export type StopReason =
  | "converged"
  | "max_concepts"
  | "max_sources"
  | "max_tokens"
  | "max_wallclock"
  | "max_rounds";

export type ConvergenceDecision = {
  done: boolean;
  status: GraphStatus; // "researching" while running; terminal otherwise
  reason: StopReason | null;
};

/** Running tallies the tracker accumulates across rounds. */
export type BudgetUsage = {
  totalConcepts: number;
  totalSources: number;
  totalTokens: number;
  elapsedMs: number;
  rounds: number;
};

/**
 * Stateful convergence + budget tracker for a single research run. Feed it the
 * result of each round via `recordRound`; ask `decide()` (or read the return of
 * `recordRound`) for the stop decision.
 */
export class ConvergenceTracker {
  private readonly budget: ResearchBudget;
  private readonly startedAt: number;
  private readonly newConceptsPerRound: number[] = [];
  private totalConcepts = 0;
  private totalSources = 0;
  private totalTokens = 0;
  private rounds = 0;

  constructor(
    budget: Partial<ResearchBudget> = {},
    now: number = Date.now(),
  ) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.startedAt = now;
  }

  /** Record one completed round and return the resulting stop decision. */
  recordRound(
    round: {
      newConcepts: number;
      sourcesUsed: number;
      tokensUsed?: number;
    },
    now: number = Date.now(),
  ): ConvergenceDecision {
    this.rounds += 1;
    this.newConceptsPerRound.push(round.newConcepts);
    this.totalConcepts += round.newConcepts;
    this.totalSources += round.sourcesUsed;
    this.totalTokens += round.tokensUsed ?? estimateTokens(round.sourcesUsed);
    return this.decide(now);
  }

  /** Current usage snapshot (for logging / events). */
  usage(now: number = Date.now()): BudgetUsage {
    return {
      totalConcepts: this.totalConcepts,
      totalSources: this.totalSources,
      totalTokens: this.totalTokens,
      elapsedMs: now - this.startedAt,
      rounds: this.rounds,
    };
  }

  /** Pure stop decision based on the current state. Budget caps win first. */
  decide(now: number = Date.now()): ConvergenceDecision {
    const b = this.budget;

    // (b) Safety budget caps — checked first so we never overrun cost.
    if (this.totalConcepts >= b.maxConcepts) return stop("max_concepts");
    if (this.totalSources >= b.maxSources) return stop("max_sources");
    if (this.totalTokens >= b.maxTokens) return stop("max_tokens");
    if (now - this.startedAt >= b.maxWallClockMs) return stop("max_wallclock");
    if (this.rounds >= b.maxRounds) return stop("max_rounds");

    // (a) Convergence — low growth sustained for `patience` rounds.
    if (this.rounds >= b.patience) {
      const recent = this.newConceptsPerRound.slice(-b.patience);
      const converged = recent.every((n) => n < b.minNewConceptsPerRound);
      if (converged) {
        return { done: true, status: "converged", reason: "converged" };
      }
    }

    return { done: false, status: "researching", reason: null };
  }
}

/** A terminal "stopped" decision for any budget-cap reason. */
function stop(reason: StopReason): ConvergenceDecision {
  return { done: true, status: "stopped", reason };
}

/** Rough token estimate when a precise count is unavailable (~600/source). */
function estimateTokens(sourcesUsed: number): number {
  return sourcesUsed * 600;
}
