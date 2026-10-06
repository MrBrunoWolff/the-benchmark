#!/bin/bash
set -euo pipefail
cat > /app/triage.json <<'REFERENCE_SOLUTION'
[
  {
    "id": "t1",
    "department": "billing",
    "priority": "low",
    "refund_requested": true
  },
  {
    "id": "t2",
    "department": "technical",
    "priority": "high",
    "refund_requested": false
  },
  {
    "id": "t3",
    "department": "technical",
    "priority": "medium",
    "refund_requested": false
  },
  {
    "id": "t4",
    "department": "sales",
    "priority": "low",
    "refund_requested": false
  },
  {
    "id": "t5",
    "department": "billing",
    "priority": "low",
    "refund_requested": false
  },
  {
    "id": "t6",
    "department": "other",
    "priority": "low",
    "refund_requested": false
  }
]
REFERENCE_SOLUTION
