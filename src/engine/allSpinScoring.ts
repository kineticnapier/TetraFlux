import {
  TetrisEngine,
  type LockEvent,
  type PieceState,
  type SpinClassification,
} from "./tetris";

type ClassifySpin = (
  lockEvent: LockEvent,
  lockedPiece: PieceState,
  lockedCells: Set<string>,
) => SpinClassification;

type EnginePrototypeInternals = {
  classifySpin: ClassifySpin;
};

const enabledEngines = new WeakSet<TetrisEngine>();
let installed = false;

function installAllSpinClassificationHook(): void {
  if (installed) return;

  const prototype = TetrisEngine.prototype as unknown as EnginePrototypeInternals;
  const original = prototype.classifySpin;
  if (typeof original !== "function") {
    throw new Error("TetrisEngine.classifySpin is unavailable");
  }

  prototype.classifySpin = function classifySpinWithAllSpin(
    this: TetrisEngine,
    lockEvent: LockEvent,
    lockedPiece: PieceState,
    lockedCells: Set<string>,
  ): SpinClassification {
    const classification = original.call(this, lockEvent, lockedPiece, lockedCells);

    if (
      !enabledEngines.has(this)
      || lockedPiece.kind === "O"
      || classification.scoring !== "none"
      || classification.mechanical !== "immobile"
    ) {
      return classification;
    }

    // lockPiece consumes this value before calculating attack and B2B, so the
    // engine follows the ordinary difficult-clear path without any correction
    // after the piece has already locked.
    return { ...classification, scoring: "spin" };
  };

  installed = true;
}

export function setAllSpinScoring(engine: TetrisEngine, enabled: boolean): void {
  installAllSpinClassificationHook();
  if (enabled) enabledEngines.add(engine);
  else enabledEngines.delete(engine);
}

export function isAllSpinScoringEnabled(engine: TetrisEngine): boolean {
  return enabledEngines.has(engine);
}
