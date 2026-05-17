import type { TetrisEngine } from "./engine/tetris";

export interface InputSettings {
  dasMs: number;
  arrMs: number;
  /**
   * Soft drop speed in cells per second.
   *
   * This is intentionally exposed as "SDF cells/s" in the UI.
   * Example:
   *   30  => one downward move every 33.3ms
   *   120 => one downward move every 8.3ms
   */
  sdfCellsPerSecond: number;
}

type Dir = -1 | 1;

/**
 * Handles DAS/ARR style horizontal movement and configurable SDF soft drop.
 *
 * Important:
 * - Browser key repeat is ignored.
 * - Horizontal held state is kept separately from repeat state.
 * - When a piece changes by hold / lock / spawn, call resetRepeatAfterPieceChange().
 *   This prevents ARR/charged state from leaking from the previous piece.
 */
export class MovementInput {
  leftHeld = false;
  rightHeld = false;
  downHeld = false;

  private leftAt = 0;
  private rightAt = 0;
  private lastPressedDir: Dir | null = null;
  private activeDir: Dir | null = null;
  private lastRepeat = 0;
  private arrCharged = false;
  private lastSoftDrop = 0;
  private softDropCarry = 0;

  private softDropToBottom(): void {
    let guard = 0;
    while (this.engine.move(0, 1) && guard < 40) {
      guard++;
    }
  }

  constructor(private engine: TetrisEngine, private settings: () => InputSettings) {}

  keyDown(key: string, now: number): boolean {
    if (key === "ArrowLeft") {
      if (!this.leftHeld) {
        this.leftHeld = true;
        this.leftAt = now;
      }
      this.lastPressedDir = -1;
      this.activeDir = -1;
      this.lastRepeat = now;
      this.arrCharged = false;
      this.engine.move(-1);
      return true;
    }

    if (key === "ArrowRight") {
      if (!this.rightHeld) {
        this.rightHeld = true;
        this.rightAt = now;
      }
      this.lastPressedDir = 1;
      this.activeDir = 1;
      this.lastRepeat = now;
      this.arrCharged = false;
      this.engine.move(1);
      return true;
    }

    if (key === "ArrowDown") {
      if (!this.downHeld) {
        this.downHeld = true;
        this.lastSoftDrop = now;
        this.softDropCarry = 0;
        const sdf = this.settings().sdfCellsPerSecond;
        if (sdf > 60) this.softDropToBottom();
        else this.engine.move(0, 1);
      }
      return true;
    }

    return false;
  }

  keyUp(key: string, now: number): boolean {
    if (key === "ArrowLeft") {
      this.leftHeld = false;

      if (this.lastPressedDir === -1) {
        this.lastPressedDir = this.rightHeld ? 1 : null;
      }

      if (this.activeDir === -1) {
        this.activeDir = this.rightHeld ? 1 : null;
        this.lastRepeat = now;
        this.arrCharged = false;
      }
      return true;
    }

    if (key === "ArrowRight") {
      this.rightHeld = false;

      if (this.lastPressedDir === 1) {
        this.lastPressedDir = this.leftHeld ? -1 : null;
      }

      if (this.activeDir === 1) {
        this.activeDir = this.leftHeld ? -1 : null;
        this.lastRepeat = now;
        this.arrCharged = false;
      }
      return true;
    }

    if (key === "ArrowDown") {
      this.downHeld = false;
      this.softDropCarry = 0;
      return true;
    }

    return false;
  }

  update(now: number): void {
    const s = this.settings();

    if (this.activeDir !== null) {
      const heldAt = this.activeDir === -1 ? this.leftAt : this.rightAt;
      if (now - heldAt >= s.dasMs) {
        if (s.arrMs <= 0) {
          if (!this.arrCharged) {
            let guard = 0;
            while (this.engine.move(this.activeDir) && guard < 20) {
              guard++;
            }
            this.arrCharged = true;
          }
        } else if (now - this.lastRepeat >= s.arrMs) {
          const repeats = Math.max(1, Math.floor((now - this.lastRepeat) / s.arrMs));
          for (let i = 0; i < repeats; i++) {
            this.engine.move(this.activeDir);
          }
          this.lastRepeat = now;
        }
      }
    }

    if (this.downHeld) {
      const cellsPerSecond = Math.max(1, Math.min(240, s.sdfCellsPerSecond));

      if (cellsPerSecond > 60) {
        this.lastSoftDrop = now;
        this.softDropCarry = 0;
        this.softDropToBottom();
      } else {
        const dtMs = Math.max(0, now - this.lastSoftDrop);
        this.lastSoftDrop = now;

        const cellsFloat = (dtMs / 1000) * cellsPerSecond + this.softDropCarry;
        const cells = Math.floor(cellsFloat);
        this.softDropCarry = cellsFloat - cells;

        const capped = Math.min(cells, 20);
        for (let i = 0; i < capped; i++) {
          this.engine.move(0, 1);
        }
      }
    }
  }

  /**
   * Rebind to a new engine instance.
   * Used on round reset.
   */
  rebind(engine: TetrisEngine): void {
    this.engine = engine;
    this.clearAllHeld();
  }

  /**
   * Called after a successful rotation/transform while a horizontal key is held.
   *
   * This fixes ARR=0 wall-charge getting "spent" at the wall, then failing to
   * re-apply after rotation changes the piece's collision box.
   */
  notifyTransform(now: number): void {
    this.arrCharged = false;
    this.lastRepeat = now;

    if (this.leftHeld && this.rightHeld) {
      this.activeDir = this.lastPressedDir;
    } else if (this.leftHeld) {
      this.activeDir = -1;
      this.lastPressedDir = -1;
    } else if (this.rightHeld) {
      this.activeDir = 1;
      this.lastPressedDir = 1;
    } else {
      this.activeDir = null;
      this.lastPressedDir = null;
    }
  }

  /**
   * Called when active piece changes but keys may still be physically held.
   *
   * This fixes:
   * - ARR leaking from previous piece into held piece after hold.
   * - ARR=0 wall-charge causing the next piece to stop because arrCharged stayed true.
   * - stale lastRepeat causing weird edge behavior.
   * - SDF fractional carry leaking into the next piece.
   */
  resetRepeatAfterPieceChange(now: number): void {
    this.arrCharged = false;
    this.lastRepeat = now;
    this.lastSoftDrop = now;
    this.softDropCarry = 0;

    if (this.leftHeld && this.rightHeld) {
      this.activeDir = this.lastPressedDir;
    } else if (this.leftHeld) {
      this.activeDir = -1;
      this.lastPressedDir = -1;
    } else if (this.rightHeld) {
      this.activeDir = 1;
      this.lastPressedDir = 1;
    } else {
      this.activeDir = null;
      this.lastPressedDir = null;
    }

    if (this.leftHeld) this.leftAt = now;
    if (this.rightHeld) this.rightAt = now;
  }

  /**
   * Emergency full reset, used on round reset / focus loss.
   */
  clearAllHeld(): void {
    this.leftHeld = false;
    this.rightHeld = false;
    this.downHeld = false;
    this.leftAt = 0;
    this.rightAt = 0;
    this.lastPressedDir = null;
    this.activeDir = null;
    this.lastRepeat = 0;
    this.arrCharged = false;
    this.lastSoftDrop = 0;
    this.softDropCarry = 0;
  }
}
