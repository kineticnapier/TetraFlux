from __future__ import annotations

from argparse import ArgumentParser
from typing import Any
import json

from .app import engine_description
from .game import main as game_main
from .simulation import run_random_batch


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(description="Pure-Python TetraFlux tools")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("info", help="Print engine capabilities")

    smoke = subparsers.add_parser("smoke", help="Run headless direct-placement games")
    smoke.add_argument("--games", type=int, default=4)
    smoke.add_argument("--max-pieces", type=int, default=200)
    smoke.add_argument("--seed-base", type=int, default=1)

    game = subparsers.add_parser("game", help="Open the Pygame client")
    game.add_argument("--seed", type=int)
    game.add_argument("--gravity-ms", type=int, default=700)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "info":
        _print_json(engine_description())
        return 0
    if args.command == "smoke":
        _print_json(run_random_batch(args.games, args.max_pieces, args.seed_base))
        return 0
    if args.command == "game":
        game_args = ["--gravity-ms", str(args.gravity_ms)]
        if args.seed is not None:
            game_args.extend(["--seed", str(args.seed)])
        game_main(game_args)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
