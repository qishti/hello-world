#!/bin/bash
# Double-click to start Folio. Pulls the latest version first, then opens the app.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
PORT=8787
URL="http://localhost:$PORT"

echo "Folio"
echo "-----"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download it from https://nodejs.org (LTS), install it, then double-click this file again."
  read -r -p "Press Enter to close."; exit 1
fi

# 1. Get the latest version (skipped quietly if offline or you have local edits).
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  before=$(git rev-parse HEAD 2>/dev/null)
  if git pull --ff-only --quiet 2>/dev/null; then
    after=$(git rev-parse HEAD 2>/dev/null)
    if [ "$before" != "$after" ]; then echo "Updated to the latest version."; else echo "Already up to date."; fi
  else
    echo "Could not check for updates (offline or local changes). Using the version on this computer."
  fi
fi

# 2. Install dependencies when missing or changed (only email-in needs them).
if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "Installing dependencies..."
  npm install --no-audit --no-fund --silent && touch node_modules
fi

# 3. Stop an older copy so the new version is the one you see.
if command -v lsof >/dev/null 2>&1; then
  old=$(lsof -ti tcp:$PORT 2>/dev/null)
  if [ -n "$old" ]; then echo "Restarting Folio..."; kill $old 2>/dev/null; sleep 1; fi
fi

# 4. Open the browser once the server is up, then run the server (closing this window stops Folio).
( for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    if curl -fs "$URL/proxy/health" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi
      break
    fi
  done ) &
echo "Starting Folio at $URL (close this window to stop it)"
node server.js
echo "Folio stopped."
read -r -p "Press Enter to close."
