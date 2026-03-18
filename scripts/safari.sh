#!/bin/bash
# Build, sign, and reload the Safari extension in one shot.
# Usage: npm run safari
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Cleaning build artifacts…"
rm -rf build/

echo "→ Generating Xcode project…"
npm run build
xcodegen generate --spec project.yml

echo "→ Cleaning Xcode derived data…"
xcodebuild -project Vimium.xcodeproj -scheme Vimium -configuration Debug clean 2>&1 | \
  grep -E '(error:|warning:|CLEAN SUCCEEDED|CLEAN FAILED)' || true

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
    -- Save window bounds before quitting
    set savedBounds to {}
    if it is running then
      try
        repeat with w in windows
          set end of savedBounds to bounds of w
        end repeat
      end try
      quit
      delay 1.5
    end if
    activate
    delay 1
    -- Reopen all tabs from previous session (Cmd+Shift+T)
    tell application "System Events"
      keystroke "t" using {command down, shift down}
    end tell
    -- Restore window bounds
    delay 0.5
    try
      set winList to windows
      repeat with i from 1 to count of savedBounds
        if i ≤ (count of winList) then
          set bounds of item i of winList to item i of savedBounds
        end if
      end repeat
    end try
  end tell
'

echo "✓ Done — Safari restarted with tabs restored"
