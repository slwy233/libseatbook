---
name: gh-fix-ci
description: Inspect GitHub Actions failures, trace the failing job, and propose or apply the CI fix.
---

# GH Fix CI

Use this skill when CI or GitHub Actions is failing.

## Workflow
1. Identify the failing workflow, job, and step.
2. Read logs and isolate the first actionable error.
3. Separate repo issues from environment issues.
4. Patch the root cause with the smallest fix.
5. Re-run or describe the exact verification command.

## Output
- Root-cause summary
- Fix plan or patch
- Verification step
