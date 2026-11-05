#!/bin/sh
# Builds the signed Android app into build/Suiji.apk.
#   --publish  also copies it to public/android/Suiji.apk, linked from the README and the release
# Raise VERSION_CODE in app/build.gradle.kts for every APK you publish, or phones won't install it over the old one.
# Needs JDK 17+ and the Android SDK (ANDROID_HOME, default ~/Library/Android/sdk). The signing key is made on the
# first run as suiji-release.keystore with its passwords in keystore.properties; both stay out of git. Keep a copy
# of both: without that key, later builds can't be installed over this one.
set -e
cd "$(dirname "$0")"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -n "$JAVA_HOME" ] || export JAVA_HOME=$(/usr/libexec/java_home -v 17+)
echo "sdk.dir=$ANDROID_HOME" > local.properties

# Launcher icons: the site's icon for each style, square (the launcher shapes it), at 108 dp for xxxhdpi.
# Launchers show only the middle 72 dp, so the icon goes there at full size, over a blown-up copy of itself
# that fills the edges the launcher may reveal when it moves the icon.
for s in glass paper terminal blocks ink eink notebook swiss neon blueprint clay sunset eyecare; do
  src=../public/icon-$s.svg; [ $s = glass ] && src=../public/icon.svg
  art=$(sed -e 's/rx="22"/rx="0"/g' "$src" | base64)
  printf '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="432" height="432"><image width="432" height="432" xlink:href="data:image/svg+xml;base64,%s"/><image x="72" y="72" width="288" height="288" xlink:href="data:image/svg+xml;base64,%s"/></svg>' "$art" "$art" \
    | rsvg-convert -w 432 -h 432 -o app/src/main/res/drawable-nodpi/icon_$s.png
done

if [ ! -f keystore.properties ]; then
  pass=$(openssl rand -hex 16)
  keytool -genkeypair -keystore suiji-release.keystore -alias suiji -keyalg RSA -keysize 4096 -validity 36500 \
    -storepass "$pass" -keypass "$pass" -dname "CN=Suiji" >/dev/null 2>&1
  printf 'storeFile=suiji-release.keystore\nstorePassword=%s\nkeyAlias=suiji\nkeyPassword=%s\n' "$pass" "$pass" > keystore.properties
  echo "Made a new signing key: android/suiji-release.keystore (password in android/keystore.properties). Back both up."
fi

./gradlew -q assembleRelease
mkdir -p build && cp app/build/outputs/apk/release/app-release.apk build/Suiji.apk
echo "built android/build/Suiji.apk"
if [ "$1" = "--publish" ]; then mkdir -p ../public/android && cp build/Suiji.apk ../public/android/Suiji.apk && echo "copied to public/android/Suiji.apk"; fi
