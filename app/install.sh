#!/bin/bash
# Build Work Board and install it to ~/Applications. A running copy notices the
# new build within a few seconds and shows "Update ready · Restart".
set -euo pipefail
cd "$(dirname "$0")"
# Tell the packaged app where the board folder (the one above app/) is.
python3 -I -c 'import json, os, sys; json.dump({"dir": os.path.dirname(os.getcwd())}, open("location.json", "w"))'
[ -d node_modules ] || npm install
npm run package
rm -rf "$HOME/Applications/Work Board.app"
mkdir -p "$HOME/Applications"
ditto "dist/Work Board-darwin-arm64/Work Board.app" "$HOME/Applications/Work Board.app"
codesign --force --deep --sign - "$HOME/Applications/Work Board.app"
echo "Installed ~/Applications/Work Board.app"
