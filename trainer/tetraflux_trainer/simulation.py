from __future__ import annotations

import random
from statistics import mean
from typing import Any

from tetraflux_engine import Game


def play_random_game(seed: int, max_pieces: int = 500) -> dict[str, Any]:
    rng = random.Random(seed ^ 0x9E3779B9)
    game = Game(seed)
    while not game.game_over and game.pieces_placed < max(1, max_pieces):
        placements = game.legal_placements()
        if not placements:
            break
        sample = rng.sample(list(placements), min(len(placements), 8))
        placement = min(
            sample,
            key=lambda candidate: abs((candidate.x + 1.5) - game.width / 2) + rng.random() * 3.0,
        )
        game.place(placement)
    return {
        "seed": seed,
        "pieces": game.pieces_placed,
        "reachedCap": game.pieces_placed >= max_pieces,
        "gameOver": game.game_over,
        "score": game.score,
        "lines": game.lines,
        "attack": game.attack,
        "linesPerPiece": game.lines / max(1, game.pieces_placed),
        "attackPerPiece": game.attack / max(1, game.pieces_placed),
    }


def run_random_batch(games: int = 4, max_pieces: int = 200, seed_base: int = 1) -> dict[str, Any]:
    count = max(1, int(games))
    cap = max(1, int(max_pieces))
    results = [play_random_game((int(seed_base) + index * 31) & 0xFFFFFFFF, cap) for index in range(count)]
    total_pieces = sum(int(result["pieces"]) for result in results)
    total_lines = sum(int(result["lines"]) for result in results)
    total_attack = sum(int(result["attack"]) for result in results)
    return {
        "config": {"games": count, "maxPieces": cap, "seedBase": int(seed_base) & 0xFFFFFFFF},
        "aggregate": {
            "games": count,
            "pieces": total_pieces,
            "survivalRate": mean(float(result["pieces"]) / cap for result in results),
            "reachedCap": sum(bool(result["reachedCap"]) for result in results),
            "topouts": sum(bool(result["gameOver"]) for result in results),
            "lines": total_lines,
            "attack": total_attack,
            "linesPerPiece": total_lines / max(1, total_pieces),
            "attackPerPiece": total_attack / max(1, total_pieces),
        },
        "perGame": results,
    }
