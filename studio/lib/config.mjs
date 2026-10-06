import { z } from 'zod';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const RUNS = resolve(process.env.BENCHMARK_DATA_DIR || join(ROOT, 'out', 'studio'));
export const VERSIONS = Object.freeze({ studio: '0.4.0', harbor: '0.24.0', pi: '1.0.4', agentNative: '0.201.1' });
export const RunSchema = z.object({
  kind: z.enum(['tasks', 'speed']),
  endpoint: z.string().default('http://localhost:11434'),
  model: z.string().trim().min(1).max(200),
  tasks: z.array(z.enum(['money-split', 'csv-parser', 'ticket-triage'])).min(1).default(['money-split', 'csv-parser', 'ticket-triage']),
  repeats: z.number().int().min(1).max(10).default(1),
  maxTurns: z.number().int().min(1).max(100).default(24),
  maxTokens: z.number().int().min(256).max(16384).default(4096),
  contextWindow: z.number().int().min(4096).max(262144).default(131072),
  timeout: z.number().int().min(30).max(3600).default(600),
  reasoning: z.enum(['default', 'none', 'low', 'medium', 'high']).default('none'),
  temperature: z.number().min(0).max(2).default(0),
  phases: z.array(z.enum(['prefill', 'generation', 'concurrent', 'agentic', 'system-one'])).min(1).default(['prefill', 'generation']),
  sizes: z.array(z.number().int().min(32).max(32768)).min(1).max(5).default([256, 2048, 8192]),
  depths: z.array(z.number().int().min(0).max(65536)).min(1).max(5).default([0]),
  concurrency: z.array(z.number().int().min(1).max(16)).min(1).max(5).default([1, 2, 4]),
  genTokens: z.number().int().min(32).max(4096).default(256),
}).strict();

// Studio is deliberately local-only. No remote providers, bearer keys, or URL redirects.
export function localEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a local HTTP endpoint'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('Use localhost or a loopback IP, with an optional /v1 path');
  }
  url.pathname = '';
  return url.origin;
}
export function containerEndpoint(endpoint) {
  const url = new URL(localEndpoint(endpoint));
  url.hostname = 'host.docker.internal';
  return `${url.origin}/v1`;
}
export function parseConfig(input) {
  const config = RunSchema.parse(input);
  config.endpoint = localEndpoint(config.endpoint);
  if (config.kind === 'speed') config.temperature = 0;
  config.tasks = [...new Set(config.tasks)];
  config.phases = [...new Set(config.phases)];
  if (config.maxTokens >= config.contextWindow) throw new Error('Output budget must be smaller than the context window');
  return config;
}
export function harborConfig(config, id, root = ROOT, runs = join(root, 'out', 'studio')) {
  return {
    job_name: 'job', jobs_dir: join(runs, id), n_attempts: config.repeats,
    n_concurrent_trials: 1, quiet: true, retry: { max_retries: 0 },
    environment: { type: 'docker', delete: true },
    agents: [{ import_path: 'benchmark_harness:BenchmarkPi', model_name: `openai/${config.model}`,
      override_timeout_sec: config.timeout,
      kwargs: { version: VERSIONS.pi, model_api: 'openai-completions', max_turns: config.maxTurns,
        max_tokens: config.maxTokens, context_window: config.contextWindow,
        temperature: config.temperature, reasoning: config.reasoning },
      env: { OPENAI_API_KEY: 'local-benchmark', OPENAI_BASE_URL: containerEndpoint(config.endpoint) },
    }],
    tasks: config.tasks.map(task => ({ path: join(root, 'tasks', 'local-v1', task) })),
  };
}
export function safeRelative(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0')) throw new Error('Invalid file path');
  const dest = resolve(root, relative);
  if (!dest.startsWith(resolve(root) + '/')) throw new Error('File is outside this run');
  return dest;
}
