#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

project="${0:A:h}/.."
if [[ ! -f "$project/scripts/launch.mjs" ]]; then
  project="$HOME/Documents/meus-projetos/WayNoted-main"
fi
if [[ ! -x "$project/scripts/launch.command" ]]; then
  print -u2 -- "Não encontrei o checkout local do WayNoted em $project."
  exit 1
fi

exec "$project/scripts/launch.command" --open-built
