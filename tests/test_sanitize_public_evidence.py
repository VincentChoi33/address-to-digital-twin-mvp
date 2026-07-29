import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sanitize_public_evidence.py"
SPEC = importlib.util.spec_from_file_location("sanitize_public_evidence", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SanitizePublicEvidenceTests(unittest.TestCase):
    def test_redacts_home_directories(self) -> None:
        source = "mac=/Users/example/project linux=/home/runner/project"
        self.assertEqual(
            MODULE.sanitize_text(source),
            "mac=${HOME}/project linux=${HOME}/project",
        )

    def test_redacts_private_and_cgnat_addresses(self) -> None:
        source = "lan=192.168.1.9 cgnat=100.112.23.29 public=8.8.8.8"
        self.assertEqual(
            MODULE.sanitize_text(source),
            "lan=<private-host> cgnat=<private-host> public=8.8.8.8",
        )

    def test_preserves_loopback_and_unspecified_addresses(self) -> None:
        source = "localhost=127.0.0.1 bind=0.0.0.0"
        self.assertEqual(MODULE.sanitize_text(source), source)


if __name__ == "__main__":
    unittest.main()
