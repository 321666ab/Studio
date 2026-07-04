#!/bin/bash
# Regenerate all app icon assets directly from the original artwork.
#
#   script/generate_icon.sh
#
# Inputs:  build/icon-artwork.png (original logo art — the robot-cat squircle)
# Outputs: build/icon-source.png, build/icon-cropped.png,
#          build/AppIcon.iconset/*, build/icon.icns
#
# The artwork is used as-is (rounded corners already baked in); no liquid-glass
# compositing. build/icon.svg.tmpl is kept only for reference.
set -euo pipefail

cd "$(dirname "$0")/.."

ART=build/icon-artwork.png
SOURCE=build/icon-source.png
CROPPED=build/icon-cropped.png
ICONSET=build/AppIcon.iconset

[[ -f "$ART" ]] || { echo "missing $ART" >&2; exit 1; }

echo "==> render $ART -> $SOURCE (1024px)"
sips -z 1024 1024 "$ART" --out "$SOURCE" >/dev/null

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

echo "done: $SOURCE, $CROPPED, $ICONSET, build/icon.icns"
