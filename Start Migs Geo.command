#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 24 or newer is required. Install it from https://nodejs.org.'
  read '?Press Return to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Run npm ci in this folder first.'
  read '?Press Return to close.'
  exit 1
fi
if [[ ! -f dist/index.html ]]; then
  npm run build || exit 1
fi
print 'Open http://127.0.0.1:4387 in your browser. Keep this window open while studying.'
npm start
