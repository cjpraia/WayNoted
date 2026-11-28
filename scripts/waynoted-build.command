#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Works both inside the checkout and as a copy on this Mac's Desktop.
project="${0:A:h}/.."
if [[ ! -f "$project/scripts/launch.mjs" ]]; then
  project="$HOME/Documents/meus-projetos/WayNoted-main"
fi
if [[ ! -x "$project/scripts/launch.command" ]]; then
  print -u2 -- "Não encontrei o checkout local do WayNoted em $project."
  exit 1
fi

print -- "Compilando o WayNoted a partir de ${project:A}"
exec "$project/scripts/launch.command" --rebuild
