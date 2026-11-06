#!/bin/sh
# Regenerates the oracle (tests/fixtures/bibtex/oracle/): Pandoc's own
# BibLaTeX → CSL-JSON reading of every corpus file, which
# tests/bibtex-oracle.test.ts compares parseBibtex against. Needs `pandoc` on
# PATH; record its version in tests/fixtures/bibtex/README.md when you run it.
# Pandoc's test cases (GPL) are read from the fetched checkout
# (`vp run oracles:fetch`), never vendored; only Pandoc's output is committed.
#
# A file Pandoc cannot read within the time and memory bounds gets no oracle
# (the test still checks that parseBibtex reads it totally).
set -eu
cd "$(dirname "$0")/.."
fixtures=tests/fixtures/bibtex
out=$fixtures/oracle

convert() { # convert <input.bib> <output.json>
  if (ulimit -v 2000000; timeout 60 pandoc -f biblatex -t csljson "$1") > "$2.tmp" 2>/dev/null; then
    mv "$2.tmp" "$2"
  else
    rm -f "$2.tmp" "$2"
    echo "no oracle: $1" >&2
  fi
}

for corpus in biber better-bibtex; do
  mkdir -p "$out/$corpus"
  for file in "$fixtures/$corpus"/*.bib; do
    convert "$file" "$out/$corpus/$(basename "$file" .bib).json"
  done
done

mkdir -p "$out/pandoc"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
for case in .oracles/pandoc/test/command/biblatex-*.md .oracles/pandoc/test/command/bibtex-*.md; do
  name=$(basename "$case" .md)
  # The input is the text between the `% pandoc` command line and `^D`.
  awk '/^% pandoc/ { on = 1; next } /^\^D$/ { exit } on { print }' "$case" > "$scratch/$name.bib"
  convert "$scratch/$name.bib" "$out/pandoc/$name.json"
done
