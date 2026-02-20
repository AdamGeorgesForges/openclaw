#!/usr/bin/env bash
set -euo pipefail

# Sync helper for fork workflows:
# - ensures an upstream remote exists
# - fetches upstream refs
# - rebases current branch onto upstream/main (or merges with --merge)
# - prints a short changelog summary between old and new HEAD

UPSTREAM_REMOTE=${UPSTREAM_REMOTE:-upstream}
UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/openclaw/openclaw.git}
UPSTREAM_BRANCH=${UPSTREAM_BRANCH:-main}
MODE=${1:---rebase}

if [[ "$MODE" != "--rebase" && "$MODE" != "--merge" ]]; then
  echo "Usage: $(basename "$0") [--rebase|--merge]" >&2
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this from inside a git repository." >&2
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "Adding remote '$UPSTREAM_REMOTE' -> $UPSTREAM_URL"
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

echo "Fetching $UPSTREAM_REMOTE..."
git fetch "$UPSTREAM_REMOTE" --prune

current_branch=$(git rev-parse --abbrev-ref HEAD)
old_head=$(git rev-parse HEAD)

if [[ "$MODE" == "--rebase" ]]; then
  echo "Rebasing '$current_branch' onto $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  git rebase "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
else
  echo "Merging $UPSTREAM_REMOTE/$UPSTREAM_BRANCH into '$current_branch'"
  git merge --no-ff "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
fi

new_head=$(git rev-parse HEAD)

echo
if [[ "$old_head" == "$new_head" ]]; then
  echo "Already up to date with $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
else
  echo "Updated $current_branch"
  echo "  old: $old_head"
  echo "  new: $new_head"
  echo
  echo "New commits introduced from upstream:"
  git log --oneline "$old_head..$new_head"
fi
