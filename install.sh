#!/bin/bash
# Set up Work Board on a Mac: check the config and tools, create the database,
# build the app, then schedule the hourly check with launchd. Safe to rerun
# after editing config.toml.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
# The same PATH run.sh uses, so these checks find what the hourly run will. Your own PATH comes
# after it, so a Node installed with a version manager still builds the app.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
  echo "Work Board needs Python 3.11 or newer; python3 here is $(python3 --version 2>&1). Try: brew install python"
  exit 1
fi
node_ok='const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'
if ! node -e "$node_ok" 2>/dev/null; then
  echo "Building the app needs Node.js 22.12 or newer; found $(node --version 2>/dev/null || echo none). Try: brew install node"
  exit 1
fi
if [ ! -f config.toml ]; then
  cp config.example.toml config.toml
  echo "Created config.toml. Fill it in, then run ./install.sh again."
  exit 1
fi
python3 -I config.py check || { echo "Fix config.toml or install what's missing, then run ./install.sh again."; exit 1; }
mkdir -p logs
python3 -I config.py init

# Build the app before anything runs on a schedule.
app/install.sh
python3 -I config.py schedule
echo "Done. Open Work Board and press Check now (or run ./run.sh) to fill the board."
