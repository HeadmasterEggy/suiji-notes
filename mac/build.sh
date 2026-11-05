#!/bin/sh
# Builds 随记.app into mac/build/.
#   --install  also copies it to /Applications (or ~/Applications)
#   --publish  also writes public/mac/Suiji.zip and version.json; installed apps update to it after the next deploy
# Raise BUILD for every release you publish; installed apps only update to a higher BUILD.
set -e
VERSION=${VERSION:-1.7}
BUILD=${BUILD:-7}
NOTES="Eight new styles, each with its own Dock icon: Ink, E-ink, Notebook, Swiss, Neon, Blueprint, Clay and Sunset. 八种新风格，各有自己的 Dock 图标：水墨、墨水屏、手帐、瑞士、霓虹、蓝图、粘土、日落。"
cd "$(dirname "$0")"
APP="build/随记.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -target arm64-apple-macos13 -o build/suiji-arm64 main.swift LocalFiles.swift
swiftc -O -swift-version 5 -target x86_64-apple-macos13 -o build/suiji-x86_64 main.swift LocalFiles.swift
lipo -create build/suiji-arm64 build/suiji-x86_64 -output "$APP/Contents/MacOS/Suiji"
rm build/suiji-arm64 build/suiji-x86_64

# App icon: AppIcon.png is 1024 px, drawn inside the macOS rounded square (the web icons fill the square)
ICONSET=build/AppIcon.iconset
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s AppIcon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d AppIcon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
cp AppIcon-*.png "$APP/Contents/Resources/"   # Dock icons for the other styles
rm -rf "$ICONSET"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>随记</string>
  <key>CFBundleDisplayName</key><string>随记</string>
  <key>CFBundleIdentifier</key><string>app.suiji.mac</string>
  <key>CFBundleExecutable</key><string>Suiji</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>随记</string>
</dict></plist>
PLIST

codesign --force --deep --sign - "$APP"
echo "built $APP"

for arg in "$@"; do case $arg in
--publish)
  mkdir -p ../public/mac
  ditto -c -k --keepParent "$APP" ../public/mac/Suiji.zip
  printf '{"version":"%s","build":%s,"url":"Suiji.zip","notes":"%s"}\n' "$VERSION" "$BUILD" "$NOTES" > ../public/mac/version.json
  echo "published $VERSION ($BUILD) to public/mac/ — deploy to release it"
  ;;
esac; done

if [ "$1" = "--install" ] || [ "$2" = "--install" ]; then
  DEST=/Applications
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST" && rm -rf "$DEST/随记.app" && cp -R "$APP" "$DEST/"
  echo "installed $DEST/随记.app"
fi
