#!/bin/bash
set -euo pipefail
mkdir -p /logs/verifier
node /tests/verify.mjs
