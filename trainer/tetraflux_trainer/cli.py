from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
from typing import Any
import json

from .node_client import NodeTrainerClient
from .protocol import EvaluationConfig, extract_flat_weights, read_json_file


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(description="TetraFlux Python trainer protocol client")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("ping", help="Start the Node simulator and check the protocol")
    subparsers.add_parser("describe", help="Print simulator capabilities")

    evaluate = subparsers.add_parser("evaluate-flat", help="Evaluate one Flat profile")
    evaluate.add_argument("profile", type=Path)
    evaluate.add_argument("--games", type=int, default=4)
    evaluate.add_argument("--max-pieces", type=int, default=200)
    evaluate.add_argument("--seed-base", type=int, default=1)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    with NodeTrainerClient() as client:
        if args.command == "ping":
            _print_json(client.ping())
            return 0
        if args.command == "describe":
            _print_json(client.describe())
            return 0
        if args.command == "evaluate-flat":
            weights = extract_flat_weights(read_json_file(args.profile))
            result = client.evaluate_flat(
                weights,
                EvaluationConfig(
                    games=args.games,
                    max_pieces=args.max_pieces,
                    seed_base=args.seed_base,
                ),
            )
            _print_json(result)
            return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
