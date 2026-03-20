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
    set savedWindows to {}
    if it is running then
      try
        repeat with w in windows
          set winBounds to bounds of w
          set winURLs to {}
          set currentTab to current tab of w
          set tabIdx to 0
          repeat with j from 1 to count of tabs of w
            set end of winURLs to URL of tab j of w
            if tab j of w = currentTab then
              set tabIdx to j
            end if
          end repeat
          set end of savedWindows to {tabURLs:winURLs, tabIndex:tabIdx, winBounds:winBounds}
        end repeat
      end try
      quit
      delay 1.5
    end if

    activate
    tell application "System Events"
      repeat 20 times
        if frontmost of process "Safari" then exit repeat
        delay 0.25
      end repeat
    end tell
    delay 0.5

    if (count of savedWindows) = 0 then return

    -- Close the default blank window Safari opens on launch
    try
      if (count of windows) = 1 then
        set tabURL to URL of current tab of window 1
        if tabURL is missing value or tabURL is "" or tabURL starts with "favorites://" then
          close window 1
        end if
      end if
    end try

    repeat with i from 1 to count of savedWindows
      set winInfo to item i of savedWindows
      set urls to tabURLs of winInfo

      if (count of urls) > 0 then
        make new document with properties {URL:item 1 of urls}
        delay 0.3
        set w to window 1

        repeat with j from 2 to count of urls
          tell w
            make new tab with properties {URL:item j of urls}
          end tell
        end repeat

        set bounds of w to winBounds of winInfo
        set tabIdx to tabIndex of winInfo
        if tabIdx > 0 and tabIdx ≤ (count of tabs of w) then
          set current tab of w to tab tabIdx of w
        end if
      end if
    end repeat

    activate
  end tell
'

echo "✓ Done — Safari restarted with tabs restored"
