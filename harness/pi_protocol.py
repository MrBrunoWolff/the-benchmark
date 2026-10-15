"""Small, dependency-free helpers for the pinned Pi adapter."""
import json
from pathlib import Path


def extension_source(max_turns, reasoning):
    source = Path(__file__).with_name("pi-extension.mjs").read_text()
    config = json.dumps({"maxTurns": max_turns, "reasoning": reasoning})
    return source + "\nexport default pi => configureBenchmark(pi, " + config + ");\n"


def check_pi_result(return_code, stdout):
    if return_code != 0:
        raise RuntimeError(f"Pi exited with status {return_code}; see agent/pi.txt")
    budget_abort = False
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "benchmark_budget" and event.get("termination") == "abort":
            budget_abort = True
        message = event.get("message")
        if (event.get("type") == "message_end" and isinstance(message, dict)
                and message.get("stopReason") == "error"):
            if budget_abort and message.get("errorMessage") == "This operation was aborted":
                continue
            raise RuntimeError(
                f"Local model request failed: {message.get('errorMessage', 'unknown error')}"
            )
