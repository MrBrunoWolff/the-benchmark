"""Cached Pi runtime for Harbor. All inference uses the selected local endpoint.

Reuse Harbor's Pi trajectory/accounting implementation, with installation baked
into our task image and explicit, isolated per-attempt model configuration.
"""
import json
import shlex
import ipaddress
from pathlib import PurePosixPath
from urllib.parse import urlsplit, urlunsplit

from harbor.agents.installed.pi import Pi, PiOptions
from pydantic import Field
from harbor.models.task.config import NetworkPolicy

PI_VERSION = "1.0.4"


class BenchmarkPiOptions(PiOptions):
    context_window: int = Field(default=32768, ge=4096)
    max_tokens: int = Field(default=4096, ge=256)
    temperature: float = Field(default=0, ge=0, le=2)
    reasoning: str = "none"


class BenchmarkPi(Pi):
    options_model = BenchmarkPiOptions

    def get_version_command(self):
        return "pi --version"

    async def install(self, environment):
        result = await self.exec_as_agent(environment, command="pi --version")
        if result.return_code != 0 or result.stdout.strip() != PI_VERSION:
            raise RuntimeError("Build the-benchmark-pi:1.0.4 before running tasks")

    async def run(self, instruction, environment, context):
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Expected provider/model")
        model_id = self.model_name.split("/", 1)[1]
        access = self.model_connection
        if not access.configured_base_url:
            raise ValueError("A local base URL is required")
        # Resolve Docker Desktop's host bridge once. Allowlisting its IP avoids
        # hostname sniffing on reused HTTP connections in Harbor's egress proxy.
        url = urlsplit(access.configured_base_url)
        if url.hostname != "host.docker.internal":
            raise ValueError("Inference must use the Docker host bridge")
        resolved = await environment.exec(command="node -e \"require('dns').lookup('host.docker.internal',{family:4},(e,a)=>{if(e)process.exit(1);console.log(a)})\"")
        if resolved.return_code != 0:
            raise RuntimeError("Cannot resolve Docker host bridge")
        address = str(ipaddress.IPv4Address(resolved.stdout.strip()))
        await environment.set_network_policy(NetworkPolicy(network_mode="allowlist", allowed_hosts=["host.docker.internal", address]))
        port = url.port or (443 if url.scheme == "https" else 80)
        # Harbor 0.24's transparent HTTP proxy can truncate larger streaming
        # requests. Route only the already-allowed model IP/port directly;
        # other traffic remains subject to the proxy's allowlist. The agent
        # container has no NET_ADMIN capability to change these rules.
        await environment._run_docker_compose_command([
            "exec", "--no-TTY", environment._EGRESS_CONTROL_SERVICE_NAME,
            "nft", "insert", "rule", "inet", "gost_egress", "output",
            "ip", "daddr", address, "tcp", "dport", str(port), "return",
        ])
        base_url = urlunsplit((url.scheme, f"{address}:{port}", url.path, "", ""))
        config_dir = PurePosixPath("/tmp/benchmark-pi")
        await self.exec_as_agent(environment, command=f"mkdir -p {config_dir}")
        sampling = {"temperature": self.options.temperature}
        if self.options.reasoning != "default":
            sampling["reasoning_effort"] = self.options.reasoning
        models = {"providers": {"benchmark-local": {
            "baseUrl": base_url,
            "apiKey": "local-benchmark",
            "api": "openai-completions",
            # Local streaming gateways may close a connection at [DONE]. Avoid
            # reusing that socket for the next tool turn (no request retries).
            "headers": {"Connection": "close"},
            "models": [{"id": model_id, "reasoning": False, "input": ["text"],
                        "contextWindow": self.options.context_window,
                        "maxTokens": self.options.max_tokens, "samplingParams": sampling,
                        "compat": {"maxTokensField": "max_tokens", "supportsStore": False,
                                   "supportsDeveloperRole": False, "requiresToolResultName": True,
                                   "requiresAssistantAfterToolResult": True},
                        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}]
        }}}
        await self._upload_config_text(environment, content=json.dumps(models),
                                       remote_path=str(config_dir / "models.json"), filename="models.json")
        await self._upload_config_text(environment,
            content=json.dumps({"compaction": {"enabled": True}, "retry": {"enabled": False}}),
            remote_path=str(config_dir / "settings.json"), filename="settings.json")
        budget = self.options.max_turns or 24
        extension = f'''export default function(pi) {{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {{
    try {{ return await originalFetch(...args); }}
    catch (error) {{
      console.log(JSON.stringify({{type:"benchmark_transport_error", message:error.message,
        cause:error.cause?.message, code:error.cause?.code}}));
      throw error;
    }}
  }};
  let turns = 0;
  pi.on("before_agent_start", event => ({{systemPrompt: event.systemPrompt +
    "\\nComplete this task within {budget} model turns. Use only local files and commands. Do not access the network."}}));
  pi.on("turn_end", (event, ctx) => {{
    if (++turns >= {budget}) {{
      console.log(JSON.stringify({{type:"benchmark_budget", maxTurns:{budget}}}));
      ctx.abort();
    }}
  }});
}}'''
        extension_path = str(config_dir / "budget.ts")
        await self._upload_config_text(environment, content=extension,
                                       remote_path=extension_path, filename="budget.ts")
        sessions = self.environment_logs_dir / self._SESSIONS_DIRECTORY
        output = self.environment_logs_dir / self._OUTPUT_FILENAME
        q = shlex.quote
        # pipefail preserves agent failures even while streaming a transcript.
        command = (f"set -o pipefail; mkdir -p {q(str(sessions))}; "
                   f"PI_CODING_AGENT_DIR={config_dir} pi --print --mode json "
                   f"--no-extensions --no-skills --no-prompt-templates "
                   f"--extension {q(extension_path)} --session-dir {q(str(sessions))} "
                   f"--provider benchmark-local --model {q(model_id)} --thinking off "
                   f"{q(instruction)} 2>&1 | stdbuf -oL tee {q(str(output))}")
        result = await self.exec_as_agent(environment, command=command, env=dict(access.env))
        if result.return_code != 0:
            raise RuntimeError(f"Pi exited with status {result.return_code}; see agent/pi.txt")
        for line in result.stdout.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            message = event.get("message", {})
            if event.get("type") == "message_end" and message.get("stopReason") == "error":
                raise RuntimeError(f"Local model request failed: {message.get('errorMessage', 'unknown error')}")
