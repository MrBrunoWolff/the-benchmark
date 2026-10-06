#!/usr/bin/env node

if (['studio', 'ui', '--ui'].includes(process.argv[2])) {
  try {
    const { launchStudio } = await import('./scripts/launch-studio.mjs');
    await launchStudio(process.argv.slice(3));
  } catch (error) {
    console.error(`Studio: ${error.message}`);
    process.exitCode = 1;
  }
} else {
  await import('./bench.mjs');
}
