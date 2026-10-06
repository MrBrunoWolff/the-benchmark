import { defineAction } from '@agent-native/core/action';
import { z } from 'zod';
import { RunSchema } from './lib/config.mjs';

// One set of typed Agent-Native actions serves the UI and local API.
export function createActions(manager) {
  return {
    discoverModels: defineAction({ description: 'List models available on a local inference server', schema: z.object({ endpoint: z.string() }), run: async ({ endpoint }) => (await import('./lib/runner.mjs')).discoverModels(endpoint) }),
    health: defineAction({ description: 'Check the local task runner', schema: z.object({}), run: () => manager.health() }),
    listRuns: defineAction({ description: 'List saved benchmark runs', schema: z.object({}), run: () => manager.list() }),
    startRun: defineAction({ description: 'Start a local benchmark attempt with fixed configuration', schema: RunSchema, run: input => manager.start(input) }),
    cancelRun: defineAction({ description: 'Cancel a benchmark and clean up its task environments', schema: z.object({ id: z.string().uuid() }), run: ({ id }) => manager.cancel(id) }),
    getRun: defineAction({ description: 'Inspect progress and results for a run', schema: z.object({ id: z.string().uuid() }), run: ({ id }) => manager.detail(id) }),
    getFile: defineAction({ description: 'Read a saved transcript, artifact or verifier log', schema: z.object({ id: z.string().uuid(), path: z.string().max(1000) }), run: ({ id, path }) => manager.file(id, path) }),
  };
}
