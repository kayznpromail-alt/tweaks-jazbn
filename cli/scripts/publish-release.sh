#!/usr/bin/env bash
# Upload a built release to the VPS and generate the manifest.
# Usage: bash scripts/publish-release.sh <exe-path> <version> <user@host>
# Example: bash scripts/publish-release.sh releases/edgey-1.0.2-win-x64.exe 1.0.2 root@194.163.138.26
set -euo pipefail

EXE="${1:?usage: publish-release.sh <exe> <version> <user@host>}"
VERSION="${2:?missing version}"
HOST="${3:?missing user@host}"
PLATFORM="win32-x64"
REMOTE_DIR="/opt/edgey/releases"

[ -f "$EXE" ] || { echo "file not found: $EXE"; exit 1; }

BYTES=$(stat -c%s "$EXE" 2>/dev/null || stat -f%z "$EXE")
SHA256=$(sha256sum "$EXE" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$EXE" | cut -d' ' -f1)
FILENAME=$(basename "$EXE")

echo "Uploading $FILENAME ($BYTES bytes, sha256=$SHA256)..."
ssh "$HOST" "mkdir -p $REMOTE_DIR"
scp "$EXE" "$HOST:$REMOTE_DIR/$FILENAME"

echo "Writing manifest.json..."
ssh "$HOST" "cat > $REMOTE_DIR/manifest.json" <<EOF
{
  "version": "$VERSION",
  "minimumLauncher": "0.0.0",
  "assets": {
    "$PLATFORM": {
      "file": "$FILENAME",
      "sha256": "$SHA256",
      "bytes": $BYTES
    }
  }
}
EOF

echo "Restarting API..."
ssh "$HOST" "cd /opt/edgey/deploy && docker compose restart api"
echo "Done. Release $VERSION is live."
