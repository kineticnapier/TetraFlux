from __future__ import annotations

import unittest

from tetraflux_engine import BOARD_HEIGHT, BOARD_WIDTH, Game, SevenBag
from tetraflux_trainer.simulation import run_random_batch


class SevenBagTests(unittest.TestCase):
    def test_each_bag_contains_all_pieces(self) -> None:
        bag = SevenBag(seed=123)
        first = [bag.pop() for _ in range(7)]
        second = [bag.pop() for _ in range(7)]
        replay = SevenBag(seed=123)
        self.assertEqual(len(set(first)), 7)
        self.assertEqual(len(set(second)), 7)
        self.assertEqual(first + second, [replay.pop() for _ in range(14)])


class GameTests(unittest.TestCase):
    def test_hard_drop_places_piece_and_spawns_next(self) -> None:
        game = Game(seed=5)
        first = game.current
        result = game.hard_drop()
        self.assertEqual(game.pieces_placed, 1)
        self.assertFalse(result.game_over)
        self.assertNotEqual(game.current, first)
        self.assertEqual(len(game.board), BOARD_HEIGHT)
        self.assertTrue(all(len(row) == BOARD_WIDTH for row in game.board))

    def test_hold_is_limited_until_lock(self) -> None:
        game = Game(seed=7)
        first = game.current
        self.assertTrue(game.hold())
        self.assertEqual(game.hold_piece, first)
        self.assertFalse(game.hold())
        game.hard_drop()
        self.assertTrue(game.hold())

    def test_horizontal_i_clears_one_line(self) -> None:
        game = Game(seed=1)
        for x in range(BOARD_WIDTH):
            if not 3 <= x <= 6:
                game.board[-1][x] = "J"
        game.current = "I"
        game.x = 3
        game.y = 1
        game.rotation = 0
        game.game_over = False
        result = game.hard_drop()
        self.assertEqual(result.lines, 1)
        self.assertEqual(game.lines, 1)

    def test_direct_placements_are_resting_and_usable(self) -> None:
        game = Game(seed=11)
        placements = game.legal_placements()
        self.assertGreater(len(placements), 0)
        result = game.place(placements[len(placements) // 2])
        self.assertEqual(game.pieces_placed, 1)
        self.assertFalse(result.game_over)

    def test_seed_is_deterministic(self) -> None:
        left = Game(seed=42)
        right = Game(seed=42)
        self.assertEqual(left.current, right.current)
        self.assertEqual(left.snapshot().queue, right.snapshot().queue)
        for _ in range(20):
            left.place(left.legal_placements()[0])
            right.place(right.legal_placements()[0])
            self.assertEqual(left.snapshot(), right.snapshot())
            if left.game_over:
                break


class SimulationTests(unittest.TestCase):
    def test_random_batch_returns_metrics(self) -> None:
        result = run_random_batch(games=2, max_pieces=20, seed_base=3)
        self.assertEqual(result["aggregate"]["games"], 2)
        self.assertEqual(len(result["perGame"]), 2)
        self.assertGreater(result["aggregate"]["pieces"], 0)


if __name__ == "__main__":
    unittest.main()
