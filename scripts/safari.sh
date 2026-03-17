#!/bin/bash
# Build, sign, and reload the Safari extension in one shot.
# Usage: npm run safari
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Cleaning build artifacts and Safari extension cache…"
rm -rf build/
rm -rf ~/Library/Containers/com.brokenalarms.Vimium.Extension

echo "→ Generating Xcode project…"
npm run build
xcodegen generate --spec project.yml

echo "→ Building Xcode project…"
xcodebuild -project Vimium.xcodeproj -scheme Vimium -configuration Debug build 2>&1 | \
  grep -E '(error:|warning:|BUILD SUCCEEDED|BUILD FAILED)' || true

# Check if build succeeded
if [ ${PIPESTATUS[0]:-0} -ne 0 ]; then
  echo "✗ Xcode build failed"
  exit 1
fi

echo "→ Reloading Safari…"
osascript -e '
  tell application "Safari"
    if it is running then
      quit
      delay 1.5
    end if
    activate
    delay 1
    -- Reopen all tabs from previous session (Cmd+Shift+T)
    tell application "System Events"
      keystroke "t" using {command down, shift down}
    end tell
  end tell
'

echo "✓ Done — Safari restarted with tabs restored"
