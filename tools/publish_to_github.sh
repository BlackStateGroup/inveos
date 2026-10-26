#!/usr/bin/env bash
# One-time, non-destructive publication helper for the *currently empty* INVEOS repo.
# Uses your own configured Git credentials. Does not create/obtain credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE="https://github.com/BlackStateGroup/inveos.git"
python3 tools/validate_foundation.py
python3 -m unittest discover -s tests -v
if [[ ! -d .git ]]; then
  git init -b main
fi
CURRENT_BRANCH="$(git branch --show-current || true)"
if [[ -n "$CURRENT_BRANCH" && "$CURRENT_BRANCH" != 'main' ]]; then
  echo "Refusing to push from branch $CURRENT_BRANCH (expected main)." >&2
  exit 2
fi
if git remote get-url origin >/dev/null 2>&1; then
  if [[ "$(git remote get-url origin)" != "$REMOTE" ]]; then
    echo 'Existing origin is different. Refusing to change it.' >&2
    exit 2
  fi
else
  git remote add origin "$REMOTE"
fi
if [[ -n "$(git ls-remote --heads origin main)" ]]; then
  echo 'Remote main exists; refusing to overwrite. Clone, compare and merge intentionally.' >&2
  exit 2
fi
if ! git config user.email >/dev/null || ! git config user.name >/dev/null; then
  echo 'Configure git user.name and user.email locally before committing.' >&2
  exit 2
fi
git add -- README.md AGENTS.md NOTICE.md CONTRIBUTING.md DELIVERY_STATUS.md MANIFEST.sha256 .gitignore docs research tools specs .github examples tests
git commit -m 'docs: establish INVEOS product blueprint and open-source research foundation'
git push --set-upstream origin main
printf '\nPublished main at: '
git rev-parse HEAD
