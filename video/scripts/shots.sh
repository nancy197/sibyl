#!/bin/bash
# Capture the live dashboard (must be running on :8787) for the video.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for tab in live track lessons payments hood; do
  hash=""; [ "$tab" != live ] && hash="#$tab"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,2160 --force-device-scale-factor=1 \
    --virtual-time-budget=12000 --screenshot="public/shots/$tab.png" "http://localhost:8787/$hash" 2>/dev/null
  echo "$tab"
done
