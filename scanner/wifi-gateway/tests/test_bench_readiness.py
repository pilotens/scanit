from __future__ import annotations

import unittest

from scanit_wifi_gateway.bench_readiness import run_pre_hardware_readiness


class BenchReadinessTests(unittest.TestCase):
    def test_all_transport_and_failure_injection_checks_pass(self) -> None:
        report = run_pre_hardware_readiness()
        self.assertTrue(
            report.passed,
            msg="; ".join(
                f"{check.id}: {check.detail}"
                for check in report.checks
                if not check.passed
            ),
        )
        self.assertEqual(report.version, "wifi-pre-hardware-readiness-v1")
        self.assertGreaterEqual(len(report.checks), 7)
        self.assertTrue(all(check.metrics for check in report.checks))


if __name__ == "__main__":
    unittest.main()
