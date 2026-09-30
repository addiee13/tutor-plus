#!/bin/sh
set -eu
diagram_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir="$diagram_dir/source"
rendered_dir="$diagram_dir/rendered"
mermaid_cli=${MERMAID_CLI:-/private/tmp/tutorplus-diagrams/node_modules/.bin/mmdc}
command -v plantuml >/dev/null
command -v dot >/dev/null
test -x "$mermaid_cli"
mkdir -p "$rendered_dir"
export PLANTUML_LIMIT_SIZE=16000
plantuml -charset UTF-8 -tsvg -o "$rendered_dir" "$source_dir"/*.puml
plantuml -charset UTF-8 -tpng -o "$rendered_dir" "$source_dir"/*.puml
for source_file in "$source_dir"/*.mmd; do
  figure_name=$(basename "$source_file" .mmd)
  "$mermaid_cli" -i "$source_file" -o "$rendered_dir/$figure_name.svg" -c "$source_dir/mermaid-config.json" -p "$source_dir/puppeteer-config.json" -b white --size 2400
  "$mermaid_cli" -i "$source_file" -o "$rendered_dir/$figure_name.png" -c "$source_dir/mermaid-config.json" -p "$source_dir/puppeteer-config.json" -b white --size 2400 -s 2
done
