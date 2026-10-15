import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pi_protocol import check_pi_result, extension_source


class PiProtocolTests(unittest.TestCase):
    def test_explicit_budget_abort_can_proceed_to_verification(self):
        output = "\n".join(json.dumps(event) for event in [
            {"type": "message_end", "message": {"stopReason": "toolUse"}},
            {"type": "benchmark_budget", "maxTurns": 1, "termination": "abort"},
            {"type": "message_end", "message": {"stopReason": "error", "errorMessage": "This operation was aborted"}},
        ])
        check_pi_result(0, output)

    def test_budget_marker_never_hides_a_real_model_error(self):
        output = "\n".join(json.dumps(event) for event in [
            {"type": "benchmark_budget", "maxTurns": 1, "termination": "abort"},
            {"type": "message_end", "message": {
                "stopReason": "error", "errorMessage": "Connection reset"}},
        ])
        with self.assertRaisesRegex(RuntimeError, "Connection reset"):
            check_pi_result(0, output)

    def test_process_errors_remain_errors(self):
        with self.assertRaisesRegex(RuntimeError, "status 7"):
            check_pi_result(7, "")

    def test_non_event_output_does_not_hide_later_errors(self):
        error = json.dumps({"type": "message_end", "message": {
            "stopReason": "error", "errorMessage": "Bad gateway"}})
        with self.assertRaisesRegex(RuntimeError, "Bad gateway"):
            check_pi_result(0, 'plain log\nnull\n[]\n' + error)

    def test_generated_extension_uses_selected_budget_and_reasoning(self):
        source = extension_source(3, "none")
        self.assertIn('"maxTurns": 3', source)
        self.assertIn('"reasoning": "none"', source)
        self.assertIn("termination: 'abort'", source)
        self.assertIn('ctx.abort()', source)

    def test_abort_without_explicit_new_marker_remains_an_error(self):
        output = json.dumps({"type": "message_end", "message": {
            "stopReason": "error", "errorMessage": "This operation was aborted"}})
        with self.assertRaisesRegex(RuntimeError, "aborted"):
            check_pi_result(0, output)


if __name__ == "__main__":
    unittest.main()
