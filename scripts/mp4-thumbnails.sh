#!/usr/bin/env bash
# Extract a frame from the middle of each MP4/MOV and save as JPG alongside the file.
# Usage: ./scripts/mp4-thumbnails.sh [dir1 [dir2 ...]]
#        ./scripts/mp4-thumbnails.sh path/to/single.mp4
# Default: public (from project root)
# Requires: ffmpeg and ffprobe (e.g. brew install ffmpeg)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

process_one() {
  local f="$1"
  local base="${f%.*}"
  local out="${base}.jpg"
  echo "  $f -> $out"
  duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f" 2>/dev/null || true)
  vf="scale=iw*sar:ih,setsar=1"
  if [[ -z "$duration" ]] || [[ ! "$duration" =~ ^[0-9.]*$ ]]; then
    ffmpeg -y -i "$f" -vf "$vf" -vframes 1 -q:v 2 "$out" 2>/dev/null || true
  else
    mid=$(awk "BEGIN { printf \"%.2f\", $duration / 2 }")
    ffmpeg -y -ss "$mid" -i "$f" -vf "$vf" -vframes 1 -q:v 2 "$out" 2>/dev/null || true
  fi
}

if [[ $# -eq 1 ]] && [[ -f "$1" ]]; then
  # Single file: must be mp4 or mov (any case)
  ext="${1##*.}"
  case "$ext" in
    mp4|MP4|mov|MOV) process_one "$1" ;;
    *) echo "Not an MP4/MOV file: $1"; exit 1 ;;
  esac
else
  dirs=("${@:-public}")
  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      echo "Skip (not a dir): $dir"
      continue
    fi
    while IFS= read -r -d '' f; do
      process_one "$f"
    done < <(find "$dir" -type f \( -iname "*.mp4" -o -iname "*.mov" \) -print0)
  done
fi
echo "Done."
