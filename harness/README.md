# Local task harness

`BenchmarkPi` extends Harbor's pinned Pi adapter, preserving its ATIF trajectory and
usage accounting. The Pi CLI is preinstalled in the task image; every attempt gets
isolated model settings and a turn-budget extension. Only a loopback model endpoint
is accepted by Studio and rewritten to Docker Desktop's host bridge.

The model adapter uses `max_tokens`, named tool results, non-null assistant messages,
and no hosted-API `store` field for Ollama/LM Studio compatibility. It records
transport errors and raises them even when Pi exits zero. Request failures are not
reported as failed functional checks.

Harbor 0.24.0 applies allowlists using a transparent GOST proxy. Larger streaming
requests to this Mac's model gateway were intermittently reset through that proxy.
The adapter resolves the host bridge and inserts an nftables NAT exception for only
that already-allowed IP and model port in the privileged sidecar. Other destinations
retain Harbor's allowlist enforcement. The agent container has no NET_ADMIN
capability. This uses Harbor's private Docker compose method, so keep Harbor pinned
and revalidate this integration before updating it. Verifiers use separate
no-network containers and never receive this route.

`requirements.txt` identifies the direct Harbor requirement; `requirements.lock`
pins the installed Python environment used by setup. The UI has a separate npm lock.
Installation and first image builds need internet; inference and grading are local.

Task instructions and initial files belong in `tasks/local-v1/<id>/`. Tests are built
into separate verifier images, and reference solutions stay outside the agent image.
`tests/verify.mjs` runs the functional checks and writes the numeric reward afterward.
For a new task, add suite metadata and the allowed task ID in Studio's schema, then
validate both its reference solution (pass) and unchanged fixture (fail) with Harbor.
Use `HARBOR_TELEMETRY=off` for direct Harbor commands, as Studio already does.
