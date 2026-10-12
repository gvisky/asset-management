#!/bin/bash
# Installs npm dependencies for Claude Code cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# The cloud container lists registry.npmjs.org in NO_PROXY, but that host
# can't be resolved directly — npm must go through the HTTPS proxy instead.
if [ -n "${HTTPS_PROXY:-}" ]; then
  export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npm_config_noproxy=localhost,127.0.0.1
fi

npm install --no-audit --no-fund
