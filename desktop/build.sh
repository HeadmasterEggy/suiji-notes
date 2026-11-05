#!/bin/sh
# Builds 随记.app (Electron) into desktop/dist/mac-arm64/, ad-hoc signed.
#   --install  also copies it to /Applications (or ~/Applications), replacing the Swift app
#   --publish  also writes dist/Suiji-$VERSION.zip for the GitHub release v$VERSION, and public/mac/version.json
#              pointing at it; installed apps (Swift or Electron) update to it once both are up
# Raise BUILD for every release you publish; installed apps only update to a higher BUILD. The Swift app is at 9.
# Apple silicon only for now.
set -e
VERSION=${VERSION:-2.0}
BUILD=${BUILD:-10}
REPO=HeadmasterEggy/suiji-notes
NOTES="随记 for Mac now runs on Electron: right-click → Inspect Element, and a fuller right-click menu. Sign in once more after updating. 随记 Mac 版换成了 Electron：右键可以「检查元素」，右键菜单更完整。更新后需要重新登录一次。"
cd "$(dirname "$0")"

[ -d node_modules/electron-builder ] || npm ci
[ -d node_modules/electron/dist ] || node node_modules/electron/install.js   # npm may skip Electron's own install script
for f in main.js preload.js localfiles.js; do node --check "$f"; done

rm -rf dist build && mkdir -p build/icons
cp ../mac/AppIcon.png build/icon.png
cp ../mac/AppIcon.png ../mac/AppIcon-*.png build/icons/   # Dock icons for the styles

# Signing is done below, ad hoc, so electron-builder does not look for a Developer ID.
npx electron-builder --mac dir --arm64 --publish never \
  -c.appId=app.suiji.mac -c.productName=随记 -c.executableName=Suiji \
  -c.extraMetadata.version="$VERSION.0" -c.buildVersion="$BUILD" \
  -c.directories.output=dist -c.directories.buildResources=build \
  -c.mac.icon=build/icon.png -c.mac.category=public.app-category.productivity -c.mac.identity=null \
  -c.mac.minimumSystemVersion=13.0 -c.electronLanguages=zh_CN -c.electronLanguages=en \
  -c.extraResources.from=build/icons -c.extraResources.to=icons \
  -c.electronFuses.runAsNode=false -c.electronFuses.enableNodeOptionsEnvironmentVariable=false \
  -c.electronFuses.enableNodeCliInspectArguments=false -c.electronFuses.onlyLoadAppFromAsar=true \
  -c.files=main.js -c.files=preload.js -c.files=localfiles.js -c.files=package.json

# electron-builder names the bundle after the executable; the Swift app's bundle is 随记.app
APP=dist/mac-arm64/随记.app
mv dist/mac-arm64/Suiji.app "$APP"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Contents/Info.plist"   # "2.0", not the semver "2.0.0" npm needs
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP"
echo "built $APP ($VERSION, build $BUILD, $(du -sh "$APP" | cut -f1))"

for arg in "$@"; do case $arg in
--publish)
  mkdir -p ../public/mac
  # The zip is about 110 MB, too big for git, so it goes on the GitHub release and version.json points there.
  ZIP=dist/Suiji-$VERSION.zip
  ditto -c -k --keepParent "$APP" "$ZIP"
  URL=https://github.com/$REPO/releases/download/v$VERSION/Suiji-$VERSION.zip
  mkdir -p ../public/mac
  printf '{"version":"%s","build":%s,"url":"%s","notes":"%s"}\n' "$VERSION" "$BUILD" "$URL" "$NOTES" > ../public/mac/version.json
  echo "wrote $ZIP ($(du -h "$ZIP" | cut -f1)) and public/mac/version.json. To release: upload the zip to v$VERSION, then deploy:"
  echo "  gh release upload v$VERSION desktop/$ZIP -R $REPO   (or gh release create v$VERSION desktop/$ZIP ...)"
  ;;
--install)
  DEST=/Applications
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST" && rm -rf "$DEST/随记.app" && cp -R "$APP" "$DEST/"
  echo "installed $DEST/随记.app"
  ;;
esac; done
