// Pi 1.0.4 aborts its tool loop at the turn cap. Mark that explicit cancellation
// so the adapter can grade the saved artifact without hiding provider failures.
export function isBudgetAbort(message, termination) {
  return termination === 'abort' && message === 'This operation was aborted';
}

export function configureBenchmark(pi, { maxTurns, reasoning }) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    try { return await originalFetch(...args); }
    catch (error) {
      console.log(JSON.stringify({ type: 'benchmark_transport_error', message: error.message,
        cause: error.cause?.message, code: error.cause?.code }));
      throw error;
    }
  };

  pi.on('before_provider_request', event => {
    const payload = { ...event.payload };
    // Pi's own "off" level may omit reasoning_effort. Send the user's explicit
    // request, including "none", through the compatible endpoint unchanged.
    if (reasoning !== 'default') payload.reasoning_effort = reasoning;
    console.log(JSON.stringify({ type: 'benchmark_request',
      reasoningEffort: payload.reasoning_effort ?? null,
      maxTokens: payload.max_tokens ?? payload.max_completion_tokens ?? null }));
    return payload;
  });

  pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt +
    `\nComplete this task within ${maxTurns} model turns. Use only local files and commands. Do not access the network.` }));

  let turns = 0;
  pi.on('turn_end', (event, ctx) => {
    // Do not mark a naturally completed final turn as budget exhaustion, and
    // never hide a real provider error by calling abort at the same boundary.
    if (++turns >= maxTurns && event.message?.role === 'assistant' && event.message.stopReason === 'toolUse') {
      console.log(JSON.stringify({ type: 'benchmark_budget', maxTurns, termination: 'abort' }));
      ctx.abort();
    }
  });
}
