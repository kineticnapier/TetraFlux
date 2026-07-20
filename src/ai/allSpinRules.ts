import type { LockResult } from "../engine/tetris";

export function isMechanicalAllSpin(result: LockResult): boolean {
  return result.ok
    && result.linesCleared > 0
    && result.piece !== "O"
    && result.lockEvent?.lastSuccessfulAction === "rotate"
    && result.spinClassification?.mechanical === "immobile";
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
