#!/usr/bin/env bash
# CI only: publish ci-results/ (screenshots, logs) to the `ci-results` branch,
# replacing what was there. Usage: scripts/push-ci-results.sh "message"
set -eu
MSG=${1:-CI results}
DIR=ci-results
[ -d "$DIR" ] || { echo "nothing to share"; exit 0; }
cd "$DIR"
rm -rf .git
git init -q
git checkout -q -b ci-results
git add -A
git -c user.name="Paint Cube CI" -c user.email="ci@users.noreply.github.com" commit -qm "$MSG"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" ci-results
echo "shared to the ci-results branch"
