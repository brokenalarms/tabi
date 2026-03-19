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
xcodebuild -project Tabi.xcodeproj -scheme Tabi -configuration Debug clean 2>&1 | \
  grep -E '(error:|warning:|CLEAN SUCCEEDED|CLEAN FAILED)' || true

echo "→ Building Xcode project…"
xcodebuild -project Tabi.xcodeproj -scheme Tabi -configuration Debug build 2>&1 | \
  grep -E '(error:|warning:|BUILD SUCCEEDED|BUILD FAILED)' || true

# Check if build succeeded
if [ ${PIPESTATUS[0]:-0} -ne 0 ]; then
  echo "✗ Xcode build failed"
  exit 1
fi

echo "→ Reloading Safari…"
osascript -e '
  tell application "Safari"
    -- Save window bounds and active tab index before quitting
    set savedBounds to {}
    set savedTabIndices to {}
    if it is running then
      try
        repeat with w in windows
          set end of savedBounds to bounds of w
          -- Find index of the current tab in this window
          set currentTab to current tab of w
          set tabIdx to 0
          repeat with j from 1 to count of tabs of w
            if tab j of w = currentTab then
              set tabIdx to j
              exit repeat
            end if
          end repeat
          set end of savedTabIndices to tabIdx
        end repeat
      end try
      quit
      delay 1.5
    end if
    activate
    -- Wait for Safari to be fully ready (frontmost with a window)
    tell application "System Events"
      repeat 20 times
        if frontmost of process "Safari" then exit repeat
        delay 0.25
      end repeat
    end tell
    delay 0.5
    -- Reopen last session tabs via Cmd+Shift+T (avoids extra start page)
    tell application "System Events"
      keystroke "t" using {command down, shift down}
    end tell
    delay 0.5
    -- Restore window bounds and active tabs
    try
      set winList to windows
      repeat with i from 1 to count of savedBounds
        if i ≤ (count of winList) then
          set bounds of item i of winList to item i of savedBounds
        end if
      end repeat
      repeat with i from 1 to count of savedTabIndices
        if i ≤ (count of winList) then
          set tabIdx to item i of savedTabIndices
          if tabIdx > 0 and tabIdx ≤ (count of tabs of item i of winList) then
            set current tab of item i of winList to tab tabIdx of item i of winList
          end if
        end if
      end repeat
    end try
  end tell
'

echo "✓ Done — Safari restarted with tabs restored"
