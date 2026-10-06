# Quality validation

This repository uses the **rich** validation tier. Install with the frozen lockfile,
using Bun 1.4.2 and Node 24. Run `bun run check:ci` before committing or opening a PR.
The command runs every configured stage and reports all stage results, even when one fails.
`check` validates code without rewriting tracked files; use the separate formatter or lint fix
commands to apply corrections.

GitHub Actions runs the same stages independently. Dependency security remains blocking but
does not prevent code or browser validation. The stable **Quality Gates** check requires all
stages to succeed; cancelled or unexpectedly skipped stages fail. Scheduled security audits
check the default-branch baseline on weekdays. Dependency update PRs retain the three-day
release-age policy; review overrides and existing advisory exceptions instead of broadening them.

The explicit commands are in `quality.config.json`. Rich checks include the applicable static checks, tests, build and diagnostics. Live model/server tests remain opt-in.

Run individual stages with `bun run check:code`, `bun run check:security`. Production publishing remains a separate job after Quality Gates.

Where installed, lint must report zero warnings/errors and Knip must report zero findings
(including stale configuration hints). React Doctor must complete its full scan, report no
warnings/errors, and return 100/100 for every scanned project. An unavailable score fails
rather than being reported as 100. Generated and vendored artifacts retain scoped exclusions.
