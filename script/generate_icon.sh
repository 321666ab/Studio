#!/bin/bash
# Regenerate all app icon assets from the original artwork + liquid glass template.
#
#   script/generate_icon.sh
#
# Inputs:  build/icon-artwork.png (original logo art), build/icon.svg.tmpl
# Outputs: build/icon.svg, build/icon-source.png, build/icon-cropped.png,
#          build/AppIcon.iconset/*, build/icon.icns
# Requires network on first run for `npx @resvg/resvg-js-cli` (not a project dependency).
set -euo pipefail

cd "$(dirname "$0")/.."

ART=build/icon-artwork.png
TMPL=build/icon.svg.tmpl
SVG=build/icon.svg
SOURCE=build/icon-source.png
CROPPED=build/icon-cropped.png
ICONSET=build/AppIcon.iconset

[[ -f "$ART" ]] || { echo "missing $ART" >&2; exit 1; }
[[ -f "$TMPL" ]] || { echo "missing $TMPL" >&2; exit 1; }

echo "==> inject artwork into $SVG"
ART_B64=$(base64 -i "$ART" | tr -d '\n')
ART_B64="$ART_B64" perl -pe 's/__ARTWORK_B64__/$ENV{ART_B64}/' "$TMPL" > "$SVG"

echo "==> render $SVG -> $SOURCE (1024px)"
npx --yes @resvg/resvg-js-cli --fit-width 1024 "$SVG" "$SOURCE"

# The artwork already contains its margins; cropped equals source.
cp "$SOURCE" "$CROPPED"

echo "==> rebuild $ICONSET"
mkdir -p "$ICONSET"
declare -a SIZES=(16 32 128 256 512)
for size in "${SIZES[@]}"; do
  sips -z "$size" "$size" "$SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  retina=$((size * 2))
  sips -z "$retina" "$retina" "$SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

echo "==> iconutil -> build/icon.icns"
iconutil -c icns "$ICONSET" -o build/icon.icns

echo "done: $SVG, $SOURCE, $CROPPED, $ICONSET, build/icon.icns"
