import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export function walkFiles(root, limit = 800, depth = 0) {
  if (!existsSync(root) || depth > 7) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(path, limit - found.length, depth + 1));
    else if (entry.isFile()) found.push(path);
    if (found.length >= limit) break;
  }
  return found.slice(0, limit);
}
export function readJson(path) {
  try {
    if (lstatSync(path).size > 10 * 1024 * 1024) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { return null; }
}
const duration = timing => timing?.finished_at && timing?.started_at
  ? Math.max(0, (Date.parse(timing.finished_at) - Date.parse(timing.started_at)) / 1000) : null;

export function taskResults(directory) {
  const trials = [];
  for (const file of walkFiles(join(directory, 'job'))) {
    if (!file.endsWith('/result.json')) continue;
    const result = readJson(file);
    if (!result?.trial_name) continue;
    const rewards = result.verifier_result?.rewards;
    const reward = rewards?.reward ?? null;
    let error = result.exception_info;
    const transcriptPath = file.replace(/result.json$/, 'agent/pi.txt');
    let budgetExhausted = false;
    try {
      const transcript = readFileSync(transcriptPath, 'utf8');
      budgetExhausted = transcript.includes('"type":"benchmark_budget"');
      for (const line of transcript.split('\n')) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'message_end' && event.message?.stopReason === 'error') {
          error = { exception_type: 'ModelRequestError', exception_message: event.message.errorMessage || 'Model request failed' };
        }
      }
    } catch {}
    const setupError = error && error.exception_type !== 'ModelRequestError' && !result.agent_execution?.started_at;
    const status = setupError ? 'setup_error' : error ? 'error' : reward === 1 ? 'passed' : reward === 0 ? 'failed' : 'ungraded';
    trials.push({
      id: result.trial_name, task: result.task_name, status, reward,
      seconds: duration(result.agent_execution), setupSeconds: duration(result.environment_setup),
      inputTokens: result.agent_result?.n_input_tokens ?? null,
      outputTokens: result.agent_result?.n_output_tokens ?? null,
      budgetExhausted,
      error: error ? { type: error.exception_type, message: error.exception_message } : null,
      checksum: result.task_checksum, agentVersion: result.agent_info?.version,
      resultFile: relative(directory, file),
    });
  }
  return trials.sort((a, b) => a.id.localeCompare(b.id));
}
export function summarize(trials, expected) {
  const passed = trials.filter(t => t.status === 'passed').length;
  const setupErrors = trials.filter(t => t.status === 'setup_error').length;
    const attempted = trials.filter(t => ['passed', 'failed'].includes(t.status)).length;
  const median = values => {
    const ordered = values.filter(v => v != null).sort((a, b) => a - b);
    if (!ordered.length) return null;
    const mid = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
  };
  const sumKnown = key => trials.some(t => t[key] != null) ? trials.reduce((sum, t) => sum + (t[key] ?? 0), 0) : null;
  return { expected, completed: trials.length, passed, failed: trials.filter(t => t.status === 'failed').length,
    setupErrors, errors: trials.filter(t => t.status === 'error').length,
    successRate: attempted ? passed / attempted : null,
    medianSeconds: median(trials.map(t => t.seconds)), inputTokens: sumKnown('inputTokens'), outputTokens: sumKnown('outputTokens'),
  };
}

export function parseSpeedOutput(output) {
  // The CLI emits one pretty-printed JSON object after its human-readable log.
  const marker = output.lastIndexOf('\n{\n');
  try { return JSON.parse(output.slice(marker + 1)); } catch { return null; }
}
