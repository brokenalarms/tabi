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
    set expectedCount to count of savedBounds
    activate
    -- Wait for Safari to be fully ready
    tell application "System Events"
      repeat 20 times
        if frontmost of process "Safari" then exit repeat
        delay 0.25
      end repeat
    end tell
    delay 0.5
    tell application "System Events"
      tell process "Safari"
        click menu item "Reopen All Windows from Last Session" of menu "History" of menu bar 1
      end tell
    end tell
    delay 1
    try
      -- Close blank windows (single empty tab)
      if (count of windows) > expectedCount then
        set idsToClose to {}
        repeat with w in windows
          if (count of tabs of w) = 1 then
            set tabURL to URL of current tab of w
            if tabURL is missing value or tabURL is "" or tabURL starts with "favorites://" then
              set end of idsToClose to id of w
            end if
          end if
        end repeat
        repeat with wid in idsToClose
          if (count of windows) > expectedCount then
            repeat with w in windows
              if id of w = wid then
                close w
                exit repeat
              end if
            end repeat
          end if
        end repeat
      end if
      -- Close blank tabs within remaining windows
      repeat with w in windows
        if (count of tabs of w) > 1 then
          set tabsToClose to {}
          repeat with j from 1 to count of tabs of w
            set tabURL to URL of tab j of w
            if tabURL is missing value or tabURL is "" or tabURL starts with "favorites://" then
              set end of tabsToClose to j
            end if
          end repeat
          -- Close in reverse order so indices stay valid
          repeat with j from (count of tabsToClose) to 1 by -1
            close tab (item j of tabsToClose) of w
          end repeat
        end if
      end repeat
    end try
    -- Bring Safari to the front
    activate
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
