from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from tetraflux_trainer.node_client import NodeTrainerClient
from tetraflux_trainer.protocol import EvaluationConfig, extract_flat_weights
from tetraflux_trainer.run_store import RunStore


class NodeTrainerClientTest(unittest.TestCase):
    def test_ping_describe_and_flat_evaluation(self) -> None:
        with NodeTrainerClient() as client:
            ping = client.ping()
            self.assertEqual(ping["protocolVersion"], 1)

            description = client.describe()
            self.assertIn("evaluate_flat", description["capabilities"])
            defaults = description["flat"]["defaultWeights"]

            result = client.evaluate_flat(
                defaults,
                EvaluationConfig(games=1, max_pieces=20, seed_base=1234),
            )
            self.assertEqual(result["aggregate"]["games"], 1)
            self.assertGreater(result["aggregate"]["pieces"], 0)

            population = client.evaluate_flat_population(
                [{"candidateId": "default", "weights": defaults}],
                EvaluationConfig(games=1, max_pieces=10, seed_base=5678),
            )
            self.assertEqual(population["candidates"][0]["candidateId"], "default")

    def test_profile_envelope_and_run_store(self) -> None:
        document = {
            "format": "tetraflux_model_envelope_v1",
            "family": "flat",
            "payload": {
                "format": "tetraflux_heuristic_weights_v1",
                "weights": {"holeWeight": 1.5},
            },
        }
        self.assertEqual(extract_flat_weights(document)["holeWeight"], 1.5)

        with TemporaryDirectory() as directory:
            run = RunStore(Path(directory)).create("fixture", {"seed": 1})
            run.append_metric({"fitness": 12.5})
            run.save_result({"ok": True})
            self.assertTrue((run.path / "config.json").is_file())
            self.assertTrue((run.path / "metrics.jsonl").is_file())
            self.assertEqual(
                json.loads((run.path / "result.json").read_text(encoding="utf-8")),
                {"ok": True},
            )


if __name__ == "__main__":
    unittest.main()
