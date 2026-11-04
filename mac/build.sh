#!/bin/sh
# Builds 随记.app into mac/build/. Pass --install to copy it to /Applications (or ~/Applications).
set -e
cd "$(dirname "$0")"
APP="build/随记.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -target arm64-apple-macos13 -o build/suiji-arm64 SuijiApp.swift
swiftc -O -swift-version 5 -target x86_64-apple-macos13 -o build/suiji-x86_64 SuijiApp.swift
lipo -create build/suiji-arm64 build/suiji-x86_64 -output "$APP/Contents/MacOS/Suiji"
rm build/suiji-arm64 build/suiji-x86_64

# App icon from the web app's icon
ICONSET=build/AppIcon.iconset
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s ../public/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d ../public/icon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
cp ../public/icon-512.png "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
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
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>随记</string>
</dict></plist>
PLIST

codesign --force --deep --sign - "$APP"
echo "built $APP"

if [ "$1" = "--install" ]; then
  DEST=/Applications
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST" && rm -rf "$DEST/随记.app" && cp -R "$APP" "$DEST/"
  echo "installed $DEST/随记.app"
fi
