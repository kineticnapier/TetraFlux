import { boardMetrics, TetrisEngine, type PlacementAction } from "../engine/tetris";
import { HeuristicAI, type AiChoice } from "./heuristic";
import { estimateSpinPotential } from "./spinPotential";
import { findReadySpinFinisherChoice } from "./spinFinisher";
import type { WebValueModel } from "./webValue";

export interface LookaheadOptions {
  depth?: number;
  beamWidth?: number;
  includeHold?: boolean;
  spinBias?: number;
  valueModel?: WebValueModel | null;
  maxCandidatesPerNode?: number;
  maxNodesPerDepth?: number;
  timeBudgetMs?: number;
}

type Node = {
  engine: TetrisEngine;
  firstAction: PlacementAction;
  seq: PlacementAction[];
  score: number;
  leafInfo: Record<string, unknown>;
};

const DEFAULTS: Required<Omit<LookaheadOptions, "valueModel">> = {
  depth: 3,
  beamWidth: 50,
  includeHold: true,
  spinBias: 1,
  maxCandidatesPerNode: 36,
  maxNodesPerDepth: 300,
  timeBudgetMs: 9,
};

function clampDepth(engine: TetrisEngine, depth: number): number {
  const q = engine.stateDict().queue.length;
  return Math.max(1, Math.min(depth, q + 2));
}

export function chooseLookaheadPlacement(engine: TetrisEngine, heuristic: HeuristicAI, options: LookaheadOptions = {}): AiChoice | null {
  const o = { ...DEFAULTS, ...options };
  const startMs = performance.now();
  const depth = clampDepth(engine, o.depth);
  const rootLegal = engine.legalPlacements(o.includeHold);
  (engine as unknown as { spinBias?: number }).spinBias = o.spinBias;
  if (!rootLegal.length) return null;

  let expandedNodes = 0;
  const rootNodes: Node[] = [];

  for (const action of rootLegal.slice(0, o.maxNodesPerDepth)) {
    const after = heuristic.scoreAfter(engine, action);
    const clone = engine.clone();
    (clone as unknown as { spinBias?: number }).spinBias = o.spinBias;
    const lock = clone.applyAction(action);
    if (!lock.ok) continue;
    expandedNodes++;
    const spinBonus = (lock.spin !== "none" ? 12 : 0) + lock.attackSent * 4 + lock.linesCleared * 2;
    rootNodes.push({ engine: clone, firstAction: action, seq: [action], score: after.score - spinBonus * o.spinBias, leafInfo: after.info });
  }

  if (!rootNodes.length) return null;
  rootNodes.sort((a, b) => a.score - b.score);
  let beam = rootNodes.slice(0, o.beamWidth);

  for (let ply = 1; ply < depth; ply++) {
    if (performance.now() - startMs > o.timeBudgetMs) break;
    const next: Node[] = [];

    for (const node of beam) {
      if (performance.now() - startMs > o.timeBudgetMs) break;
      const legal = node.engine.legalPlacements(o.includeHold);
      if (!legal.length) {
        next.push(node);
        continue;
      }

      const ranked = legal.map((action) => ({ action, probe: heuristic.scoreAfter(node.engine, action) }))
        .sort((a, b) => a.probe.score - b.probe.score)
        .slice(0, o.maxCandidatesPerNode);

      for (const cand of ranked) {
        if (next.length >= o.maxNodesPerDepth) break;
        const clone = node.engine.clone();
        (clone as unknown as { spinBias?: number }).spinBias = o.spinBias;
        const lock = clone.applyAction(cand.action);
        if (!lock.ok) continue;
        expandedNodes++;

        const state = clone.stateDict();
        const m = boardMetrics(state.board);
        const spinPotential = estimateSpinPotential(state);
        const terrainPenalty = m.holes * 0.9 + Math.max(0, m.maxHeight - 13) * 2 + m.bumpiness * 0.12 + Math.max(0, Math.max(m.heights[4] ?? 0, m.heights[5] ?? 0) - ((m.heights[0] + m.heights[9]) / 2)) * 0.8;
        const spinPotentialReward = terrainPenalty < 18 ? spinPotential.bonus * 0.6 * o.spinBias : spinPotential.bonus * 0.18 * o.spinBias;
        const finisherReward = (lock.spin !== "none" && lock.linesCleared > 0) ? (24 + lock.attackSent * 6) * o.spinBias : 0;
        const topoutPenalty = (clone.dead || lock.topout) ? 50000 : 0;
        const value = o.valueModel ? o.valueModel.evaluate(node.engine.stateDict(), cand.action) * 0.2 : 0;

        const seqScore = node.score + cand.probe.score - (lock.attackSent * 2.8 + lock.linesCleared * 1.6) - spinPotentialReward - finisherReward + terrainPenalty + topoutPenalty - value;
        next.push({ engine: clone, firstAction: node.firstAction, seq: [...node.seq, cand.action], score: seqScore, leafInfo: { ...cand.probe.info, terrainPenalty, spinPotential: spinPotential.bonus, finisherReward, value } });
      }
    }

    if (!next.length) break;
    next.sort((a, b) => a.score - b.score);
    beam = next.slice(0, o.beamWidth);
  }

  beam.sort((a, b) => a.score - b.score);
  const best = beam[0];
  if (!best) return null;

  return {
    ...best.firstAction,
    aiScore: best.score,
    aiInfo: {
      source: "lookahead_beam",
      lookaheadDepth: depth,
      beamWidth: o.beamWidth,
      expandedNodes,
      bestSequenceScore: Number(best.score.toFixed(3)),
      plannedSequence: best.seq.slice(0, 5).map((a) => a.key),
      leafMetrics: best.leafInfo,
      spinPlan: best.seq.some((a) => a.piece === "T"),
      chooseMs: Number((performance.now() - startMs).toFixed(3)),
    },
  };
}

export class LookaheadAI extends HeuristicAI {
  public lastSpinFinisherReason: string | null = null;
  constructor(public readonly lookaheadOptions: LookaheadOptions = {}) { super(); }

  choose(engine: TetrisEngine): AiChoice | null {
    const budgetMs = this.lookaheadOptions.timeBudgetMs ?? DEFAULTS.timeBudgetMs;
    const start = performance.now();
    this.lastSpinFinisherReason = null;
    const spinBias = this.lookaheadOptions.spinBias ?? DEFAULTS.spinBias;
    (engine as unknown as { spinBias?: number }).spinBias = spinBias;
    if (spinBias > 1) {
      const finisher = findReadySpinFinisherChoice(engine);
      if (finisher.choice) {
        finisher.choice.aiInfo = { ...finisher.choice.aiInfo, chooseMs: Number((performance.now() - start).toFixed(3)) };
        return finisher.choice;
      }
      this.lastSpinFinisherReason = finisher.reason ?? "no_ready_slot";
    }
    const choice = chooseLookaheadPlacement(engine, this, this.lookaheadOptions);
    if (choice) {
      if (this.lastSpinFinisherReason) choice.aiInfo = { ...choice.aiInfo, spinFinisherRejected: this.lastSpinFinisherReason };
      return choice;
    }
    const fallback = super.choose(engine);
    if (fallback) fallback.aiInfo = { ...fallback.aiInfo, source: "lookahead_fallback", chooseMs: Number((performance.now() - start).toFixed(3)), budgetMs, spinFinisherRejected: this.lastSpinFinisherReason ?? undefined };
    return fallback;
  }
}
