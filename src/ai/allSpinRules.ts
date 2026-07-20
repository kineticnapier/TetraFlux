import { attackFor, type LockResult, type TetrisEngine } from "../engine/tetris";

function allSpinBaseAttack(lines: number): number {
  if (lines <= 0) return 0;
  if (lines === 1) return 1;
  if (lines === 2) return 2;
  if (lines === 3) return 4;
  return 6;
}

export function isMechanicalAllSpin(result: LockResult): boolean {
  return result.ok
    && result.linesCleared > 0
    && result.piece !== "O"
    && result.lockEvent?.lastSuccessfulAction === "rotate"
    && result.spinClassification?.mechanical === "immobile";
}

/**
 * Upgrades a non-T immobile line clear to the engine's generic `spin` scoring.
 *
 * TetrisEngine normally calculates a non-T mechanical twist as an ordinary clear,
 * which has already reset B2B and produced ordinary-clear attack by the time the
 * LockResult is returned. This function repairs both the result and mutable engine
 * state before garbage cancellation or search evaluation observes them.
 */
export function promoteMechanicalAllSpin(
  engine: TetrisEngine,
  result: LockResult,
  b2bBefore: number,
  enabled: boolean,
): LockResult {
  if (!enabled || !isMechanicalAllSpin(result) || result.spin !== "none") return result;

  const base = allSpinBaseAttack(result.linesCleared);
  const normalizedB2bBefore = Math.max(0, Math.floor(b2bBefore));
  const b2bBonus = base > 0 && normalizedB2bBefore > 0 ? 1 : 0;
  const attack = attackFor(result.linesCleared, "spin", engine.combo, normalizedB2bBefore);
  const comboBonus = Math.max(0, attack - base - b2bBonus);
  const spinClassification: NonNullable<LockResult["spinClassification"]> = {
    ...(result.spinClassification ?? {
      mechanical: "immobile",
      lastRotation: result.lockEvent?.lastRotation ?? null,
    }),
    scoring: "spin",
    mechanical: "immobile",
    lastRotation: result.lockEvent?.lastRotation
      ?? result.spinClassification?.lastRotation
      ?? null,
  };

  // The ordinary clear path reset B2B to zero. An All-Spin clear is difficult,
  // so restore the chain using the value from immediately before the lock.
  engine.b2b = normalizedB2bBefore + 1;

  const upgraded: LockResult = {
    ...result,
    spin: "spin",
    spinClassification,
    attackSent: attack,
    rawAttack: attack,
    attackBase: base,
    attackB2bBonus: b2bBonus,
    attackComboBonus: comboBonus,
    attackCapped: false,
    b2b: normalizedB2bBefore,
  };
  engine.lastResult = upgraded;
  return upgraded;
}

export function isAllSpinLineClear(result: LockResult): boolean {
  if (!result.ok || result.linesCleared <= 0 || result.piece === "O") return false;

  if (result.spin === "tspin" || result.spin === "tspin-mini" || result.spin === "spin") {
    return true;
  }

  return isMechanicalAllSpin(result);
}

export function violatesStrictAllSpin(result: LockResult): boolean {
  return result.ok && result.linesCleared > 0 && !isAllSpinLineClear(result);
}

export function allSpinKind(result: LockResult): string {
  if (!isAllSpinLineClear(result)) return "none";
  if (result.spin === "tspin") return `tspin_${result.linesCleared}`;
  if (result.spin === "tspin-mini") return `tspin_mini_${result.linesCleared}`;
  if (result.spin === "spin") return `${String(result.piece ?? "unknown").toLowerCase()}_spin_${result.linesCleared}`;
  return `${String(result.piece ?? "unknown").toLowerCase()}_immobile_${result.linesCleared}`;
}
