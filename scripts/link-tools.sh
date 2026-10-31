#!/bin/sh
# Local dev only: link globally installed dev tools into node_modules.
# CI installs the real devDependencies with `npm ci` instead.
set -e
G=$(npm root -g)
mkdir -p node_modules
for p in typescript playwright; do
  [ -e "node_modules/$p" ] || ln -s "$G/$p" "node_modules/$p"
done
mkdir -p node_modules/.bin
ln -sf ../typescript/bin/tsc node_modules/.bin/tsc
ln -sf ../playwright/cli.js node_modules/.bin/playwright
echo "linked: typescript, playwright"
