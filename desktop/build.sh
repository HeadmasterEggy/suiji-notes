#!/bin/sh
# Builds 随记.app (Electron) into desktop/dist/mac-arm64/, ad-hoc signed.
#   --install  also copies it to /Applications (or ~/Applications), replacing the Swift app
#   --publish  also writes public/mac/Suiji.zip and version.json; installed apps (Swift or Electron) update to it after the next deploy
# Raise BUILD for every release you publish; installed apps only update to a higher BUILD. The Swift app is at 9.
#   ARCH=universal  builds for Intel Macs too (about twice the size)
set -e
VERSION=${VERSION:-2.0.0}
BUILD=${BUILD:-10}
ARCH=${ARCH:-arm64}
NOTES="随记 for Mac now runs on Electron: right-click → Inspect Element, and a fuller right-click menu. Sign in once more after updating. 随记 Mac 版换成了 Electron：右键可以「检查元素」，右键菜单更完整。更新后需要重新登录一次。"
cd "$(dirname "$0")"

[ -d node_modules/electron-builder ] || npm ci
[ -d node_modules/electron/dist ] || node node_modules/electron/install.js   # npm may skip Electron's own install script
for f in main.js preload.js localfiles.js; do node --check "$f"; done

rm -rf dist build && mkdir -p build/icons
cp ../mac/AppIcon.png build/icon.png
cp ../mac/AppIcon.png ../mac/AppIcon-*.png build/icons/   # Dock icons for the styles

# Signing is done below, ad hoc, so electron-builder does not look for a Developer ID.
npx electron-builder --mac dir "--$ARCH" --publish never \
  -c.appId=app.suiji.mac -c.productName=随记 -c.executableName=Suiji \
  -c.extraMetadata.version="$VERSION" -c.buildVersion="$BUILD" \
  -c.directories.output=dist -c.directories.buildResources=build \
  -c.mac.icon=build/icon.png -c.mac.category=public.app-category.productivity -c.mac.identity=null \
  -c.mac.minimumSystemVersion=13.0 -c.electronLanguages=zh_CN -c.electronLanguages=en \
  -c.extraResources.from=build/icons -c.extraResources.to=icons \
  -c.electronFuses.runAsNode=false -c.electronFuses.enableNodeOptionsEnvironmentVariable=false \
  -c.electronFuses.enableNodeCliInspectArguments=false -c.electronFuses.onlyLoadAppFromAsar=true \
  -c.files=main.js -c.files=preload.js -c.files=localfiles.js -c.files=package.json

# electron-builder names the bundle after the executable; the Swift app's bundle is 随记.app
APP=$(dirname dist/mac*/Suiji.app)/随记.app
mv dist/mac*/Suiji.app "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP"
echo "built $APP ($VERSION, build $BUILD, $(du -sh "$APP" | cut -f1))"

for arg in "$@"; do case $arg in
--publish)
  mkdir -p ../public/mac
  # The zip is about 110 MB, too big to keep in git; with ZIP_URL (say a GitHub release asset) it is left in
  # dist/ for upload and only version.json goes to public/mac/.
  if [ -n "$ZIP_URL" ]; then ZIP=dist/Suiji.zip; else ZIP=../public/mac/Suiji.zip; fi
  ditto -c -k --keepParent "$APP" "$ZIP"
  printf '{"version":"%s","build":%s,"url":"%s","notes":"%s"}\n' "$VERSION" "$BUILD" "${ZIP_URL:-Suiji.zip}" "$NOTES" > ../public/mac/version.json
  echo "published $VERSION ($BUILD): $ZIP ($(du -h "$ZIP" | cut -f1)) and public/mac/version.json — upload the zip if ZIP_URL is set, then deploy"
  ;;
--install)
  DEST=/Applications
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST" && rm -rf "$DEST/随记.app" && cp -R "$APP" "$DEST/"
  echo "installed $DEST/随记.app"
  ;;
esac; done
