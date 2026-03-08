#!/usr/bin/env bash
# Extract a frame from the middle of each MP4/MOV and save as JPG alongside the file.
# Usage: ./scripts/mp4-thumbnails.sh [dir1 [dir2 ...]]
# Default: public (from project root)
# Requires: ffmpeg and ffprobe (e.g. brew install ffmpeg)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
dirs=("${@:-public}")

for dir in "${dirs[@]}"; do
  if [[ ! -d "$dir" ]]; then
    echo "Skip (not a dir): $dir"
    continue
  fi
  while IFS= read -r -d '' f; do
    base="${f%.*}"
    out="${base}.jpg"
    echo "  $f -> $out"
    duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f" 2>/dev/null || true)
    # Scale to square pixels so JPG matches video display aspect ratio (fixes anamorphic/SAR)
    vf="scale=iw*sar:ih,setsar=1"
    if [[ -z "$duration" ]] || [[ ! "$duration" =~ ^[0-9.]*$ ]]; then
      # Fallback: use first frame (e.g. invalid or 0 duration)
      ffmpeg -y -i "$f" -vf "$vf" -vframes 1 -q:v 2 "$out" 2>/dev/null || true
    else
      mid=$(awk "BEGIN { printf \"%.2f\", $duration / 2 }")
      ffmpeg -y -ss "$mid" -i "$f" -vf "$vf" -vframes 1 -q:v 2 "$out" 2>/dev/null || true
    fi
  done < <(find "$dir" -type f \( -iname "*.mp4" -o -iname "*.mov" \) -print0)
done
echo "Done."
