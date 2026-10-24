#!/bin/sh
# Point git at the repo-local hooks directory so the pre-commit quality gate
# is enabled automatically after `npm install` (see "prepare" script).
if git rev-parse --git-dir >/dev/null 2>&1; then
  git config core.hooksPath .githooks
  echo "git hooks enabled: core.hooksPath=.githooks"
else
  echo "not a git repository; skipping git hooks setup"
fi
