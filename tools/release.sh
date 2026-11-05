#!/usr/bin/env bash
# Usage: tools/release.sh <version> "<what it brings>"
#   e.g. tools/release.sh 1.20.0 "rule --remove and a release warning"
# Releases soloagile: runs every check, stops at the first failure, then bumps the version
# in package.json and .claude-plugin/plugin.json, commits, pushes, tags v<version> and
# publishes it as a GitHub release with its note from pm/releases.md, and updates the
# installed plugin. Pages rebuild by themselves at each project's next session start, so
# there is no build-all. Write the release note in pm/releases.md first.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-}"
what="${2:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || -z "$what" ]]; then
  echo 'release: usage: tools/release.sh <version> "<what it brings>"' >&2
  exit 2
fi
current=$(node -p "require('./package.json').version")
if [[ "$(printf '%s\n%s\n' "$current" "$version" | sort -V | tail -1)" != "$version" || "$current" == "$version" ]]; then
  echo "release: $version is not newer than $current" >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "release: commit or put away these changes first:" >&2
  git status --short >&2
  exit 2
fi
if [[ -f pm/releases.md ]] && ! grep -q "soloagile $version" pm/releases.md; then
  echo "release: pm/releases.md has no note for soloagile $version yet" >&2
  exit 2
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "release: gh isn't signed in, so the GitHub release can't be made (gh auth login)" >&2
  exit 2
fi

echo "release: tests"
node --test >/dev/null
echo "release: plugin validate"
claude plugin validate . --strict >/dev/null
echo "release: trigger tests (about \$1)"
eval_ok=0
claude plugin eval . --ablation none --no-publish --trust-plugin -j 4 --threshold 1 || eval_ok=$?
# Eval runs leave sealed folders behind.
chmod -R u+rwx /tmp/claude-eval-* 2>/dev/null || true
rm -rf /tmp/claude-eval-*
if [[ $eval_ok -ne 0 ]]; then
  echo "release: a trigger test failed, so nothing was released" >&2
  exit 1
fi

echo "release: $current -> $version"
for f in package.json .claude-plugin/plugin.json; do
  node -e "const fs=require('fs');const f=process.argv[1];const j=fs.readFileSync(f,'utf8');fs.writeFileSync(f,j.replace(/\"version\": \"[^\"]*\"/,'\"version\": \"'+process.argv[2]+'\"'))" "$f" "$version"
done
git add package.json .claude-plugin/plugin.json
git commit -q -m "soloagile $version: $what"
git push -q origin main
git tag "v$version"
git push -q origin "v$version"
note=$(tools/release-note.sh "$version" 2>/dev/null || echo "$what")
gh release create "v$version" --title "soloagile $version" --notes "$note" >/dev/null
echo "release: GitHub release v$version is published"
claude plugin marketplace update soloagile
claude plugin update soloagile@soloagile
echo "release: soloagile $version is pushed and installed; restart Claude Code to use it"
