#!/bin/bash
set -euo pipefail
original=$(mktemp /tmp/issue180-next-config.XXXXXX)
cp next.config.ts "$original"
cleanup() { cp "$original" next.config.ts; rm "$original"; }
trap cleanup EXIT INT TERM
python3 - <<'PY'
from pathlib import Path
p=Path('next.config.ts');p.write_text(p.read_text().replace('agentRules: false,','agentRules: false,\n  experimental: { cpus: 2 },'))
PY
export PATH=/tmp/node-v22.23.4-darwin-arm64/bin:$PATH
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Users/matthewlarsen/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
export DATABASE_URL='' DIRECT_URL='' NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=''
unset E2E_DEV_BASE_URL NOTIFICATIONS_E2E_APP_URL NOTIFICATIONS_E2E_DATABASE_URL
npm run e2e -- --config=output/playwright/issue-180/standard.config.ts --workers=1
