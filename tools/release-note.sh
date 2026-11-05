#!/usr/bin/env bash
# Usage: tools/release-note.sh <version> [releases file, default pm/releases.md]
# Prints the body of the "## <date> · soloagile <version>: ..." entry, the text a GitHub
# release gets. Exits 1 when there is no entry for that version.
set -euo pipefail
version="$1"
file="${2:-$(dirname "$0")/../pm/releases.md}"
awk -v want="· soloagile $version:" '
  /^## / { if (found) exit; if (index($0, want)) { found = 1; next } }
  found { print }
  END { exit found ? 0 : 1 }
' "$file"
