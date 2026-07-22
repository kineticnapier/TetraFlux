from __future__ import annotations

import argparse

from tetraflux_engine import BOARD_WIDTH, HIDDEN_ROWS, SHAPES, VISIBLE_HEIGHT, Game

CELL = 30
BOARD_X = 42
BOARD_Y = 42
SIDE_X = BOARD_X + BOARD_WIDTH * CELL + 34
WINDOW_WIDTH = 640
WINDOW_HEIGHT = 720

COLORS = {
    None: (30, 34, 44),
    "I": (68, 205, 220),
    "O": (240, 207, 72),
    "T": (170, 92, 220),
    "S": (94, 195, 95),
    "Z": (220, 78, 78),
    "J": (74, 112, 220),
    "L": (230, 145, 64),
}
GRID = (52, 57, 70)
TEXT = (232, 235, 242)
MUTED = (157, 164, 181)
PANEL = (24, 27, 36)
GHOST = (100, 108, 126)


def _piece_cells(piece: str, rotation: int = 0) -> tuple[tuple[int, int], ...]:
    return SHAPES[piece][rotation % 4]


class PygameGame:
    def __init__(self, seed: int | None = None, gravity_ms: int = 700) -> None:
        try:
            import pygame
        except ImportError as error:
            raise RuntimeError(
                "Pygame is not installed. Run: python -m pip install -e 'trainer[game]'"
            ) from error
        self.pg = pygame
        pygame.init()
        pygame.display.set_caption("TetraFlux Python")
        self.screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
        self.clock = pygame.time.Clock()
        self.font = pygame.font.Font(None, 28)
        self.small_font = pygame.font.Font(None, 22)
        self.large_font = pygame.font.Font(None, 48)
        self.game = Game(seed)
        self.seed = seed
        self.gravity_ms = max(40, gravity_ms)
        self.last_gravity = pygame.time.get_ticks()
        self.running = True
        self.paused = False
        pygame.key.set_repeat(150, 45)

    def reset(self) -> None:
        self.game.reset(self.seed)
        self.last_gravity = self.pg.time.get_ticks()
        self.paused = False
        self.game.paused = False

    def run(self) -> None:
        while self.running:
            self._handle_events()
            now = self.pg.time.get_ticks()
            if not self.paused and not self.game.game_over and now - self.last_gravity >= self.gravity_ms:
                self.game.gravity_step()
                self.last_gravity = now
            self._draw()
            self.pg.display.flip()
            self.clock.tick(60)
        self.pg.quit()

    def _handle_events(self) -> None:
        pg = self.pg
        for event in pg.event.get():
            if event.type == pg.QUIT:
                self.running = False
                continue
            if event.type != pg.KEYDOWN:
                continue
            if event.key == pg.K_ESCAPE:
                self.running = False
            elif event.key == pg.K_r:
                self.reset()
            elif event.key == pg.K_p:
                self.paused = not self.paused
                self.game.paused = self.paused
            elif self.game.game_over or self.paused:
                continue
            elif event.key == pg.K_LEFT:
                self.game.move_left()
            elif event.key == pg.K_RIGHT:
                self.game.move_right()
            elif event.key == pg.K_DOWN:
                self.game.soft_drop()
            elif event.key in (pg.K_UP, pg.K_x):
                self.game.rotate_cw()
            elif event.key == pg.K_z:
                self.game.rotate_ccw()
            elif event.key == pg.K_a:
                self.game.rotate_180()
            elif event.key in (pg.K_c, pg.K_LSHIFT, pg.K_RSHIFT):
                self.game.hold()
            elif event.key == pg.K_SPACE:
                self.game.hard_drop()
                self.last_gravity = pg.time.get_ticks()

    def _draw_cell(self, x: int, y: int, piece: str | None, *, ghost: bool = False) -> None:
        pg = self.pg
        rect = pg.Rect(
            BOARD_X + x * CELL + 1,
            BOARD_Y + (y - HIDDEN_ROWS) * CELL + 1,
            CELL - 2,
            CELL - 2,
        )
        if ghost:
            pg.draw.rect(self.screen, GHOST, rect, width=2, border_radius=4)
            return
        color = COLORS[piece]
        pg.draw.rect(self.screen, color, rect, border_radius=4)
        if piece is not None:
            highlight = tuple(min(255, channel + 30) for channel in color)
            pg.draw.line(self.screen, highlight, rect.topleft, rect.topright, 2)
            pg.draw.line(self.screen, highlight, rect.topleft, rect.bottomleft, 2)

    def _draw_piece_preview(self, piece: str | None, left: int, top: int, scale: int = 22) -> None:
        if not piece:
            return
        pg = self.pg
        cells = _piece_cells(piece)
        min_x = min(x for x, _ in cells)
        min_y = min(y for _, y in cells)
        for x, y in cells:
            rect = pg.Rect(left + (x - min_x) * scale, top + (y - min_y) * scale, scale - 2, scale - 2)
            pg.draw.rect(self.screen, COLORS[piece], rect, border_radius=3)

    def _label(self, text: str, x: int, y: int, *, muted: bool = False, large: bool = False) -> None:
        font = self.large_font if large else self.font
        surface = font.render(text, True, MUTED if muted else TEXT)
        self.screen.blit(surface, (x, y))

    def _draw(self) -> None:
        pg = self.pg
        self.screen.fill(PANEL)
        board_rect = pg.Rect(BOARD_X, BOARD_Y, BOARD_WIDTH * CELL, VISIBLE_HEIGHT * CELL)
        pg.draw.rect(self.screen, COLORS[None], board_rect, border_radius=6)

        snapshot = self.game.snapshot()
        for visible_y, row in enumerate(snapshot.board[HIDDEN_ROWS:]):
            board_y = visible_y + HIDDEN_ROWS
            for x, piece in enumerate(row):
                self._draw_cell(x, board_y, piece)
        for x in range(BOARD_WIDTH + 1):
            px = BOARD_X + x * CELL
            pg.draw.line(self.screen, GRID, (px, BOARD_Y), (px, BOARD_Y + VISIBLE_HEIGHT * CELL), 1)
        for y in range(VISIBLE_HEIGHT + 1):
            py = BOARD_Y + y * CELL
            pg.draw.line(self.screen, GRID, (BOARD_X, py), (BOARD_X + BOARD_WIDTH * CELL, py), 1)

        if not snapshot.game_over:
            for x, y in self.game.cells(y=snapshot.ghost_y):
                if y >= HIDDEN_ROWS:
                    self._draw_cell(x, y, snapshot.current, ghost=True)
            for x, y in self.game.cells():
                if y >= HIDDEN_ROWS:
                    self._draw_cell(x, y, snapshot.current)

        self._label("HOLD", SIDE_X, 46, muted=True)
        self._draw_piece_preview(snapshot.hold, SIDE_X, 76)
        self._label("NEXT", SIDE_X, 162, muted=True)
        preview_y = 194
        for piece in snapshot.queue[:5]:
            self._draw_piece_preview(piece, SIDE_X, preview_y, 18)
            preview_y += 62

        stats_y = 512
        self._label(f"Score  {snapshot.score}", SIDE_X, stats_y)
        self._label(f"Lines  {snapshot.lines}", SIDE_X, stats_y + 30)
        self._label(f"Attack {snapshot.attack}", SIDE_X, stats_y + 60)
        self._label(f"Pieces {snapshot.pieces_placed}", SIDE_X, stats_y + 90)
        self._label(f"Combo  {max(0, snapshot.combo)}", SIDE_X, stats_y + 120)
        self._label("B2B" if snapshot.back_to_back else "No B2B", SIDE_X, stats_y + 150, muted=not snapshot.back_to_back)

        self._label("←/→ move  ↓ soft drop", 42, 654, muted=True)
        self._label("Z/X rotate  A 180°  C hold  Space drop", 42, 678, muted=True)

        if self.paused:
            self._overlay("PAUSED", "P: resume")
        elif snapshot.game_over:
            self._overlay("GAME OVER", "R: restart")

    def _overlay(self, title: str, subtitle: str) -> None:
        pg = self.pg
        overlay = pg.Surface((BOARD_WIDTH * CELL, VISIBLE_HEIGHT * CELL), pg.SRCALPHA)
        overlay.fill((10, 12, 18, 190))
        self.screen.blit(overlay, (BOARD_X, BOARD_Y))
        title_surface = self.large_font.render(title, True, TEXT)
        subtitle_surface = self.font.render(subtitle, True, MUTED)
        center_x = BOARD_X + BOARD_WIDTH * CELL // 2
        center_y = BOARD_Y + VISIBLE_HEIGHT * CELL // 2
        self.screen.blit(title_surface, title_surface.get_rect(center=(center_x, center_y - 18)))
        self.screen.blit(subtitle_surface, subtitle_surface.get_rect(center=(center_x, center_y + 25)))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Play the pure-Python TetraFlux game")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--gravity-ms", type=int, default=700)
    args = parser.parse_args(argv)
    PygameGame(seed=args.seed, gravity_ms=args.gravity_ms).run()


if __name__ == "__main__":
    main()
