#!/usr/bin/env bash
set -euo pipefail

# Run the Codama CLI to generate the JS client
npx codama run js

# Ensure the generated package.json has "type": "module"
PKG="clients/js/package.json"
if [ -f "$PKG" ]; then
  node -e "
    const pkg = JSON.parse(require('fs').readFileSync('$PKG','utf-8'));
    pkg.type = 'module';
    require('fs').writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "Patched $PKG with \"type\": \"module\""
fi

echo "Done — client generated in clients/js/src/generated/"
