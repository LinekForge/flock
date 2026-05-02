#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Flock"
APP="$SCRIPT_DIR/$APP_NAME.app"
SRC="$SCRIPT_DIR/app"
WEB_DIR="$SCRIPT_DIR/web"
DAEMON_DIR="$SCRIPT_DIR/daemon"

echo "=== 编译 Flock ==="

# 1. Quit existing
osascript -e "tell application \"$APP_NAME\" to quit" 2>/dev/null || true
sleep 1

# 2. Install dependencies
echo "  → 安装依赖..."
(cd "$DAEMON_DIR" && bun install --frozen-lockfile)
(cd "$WEB_DIR" && bun install --frozen-lockfile)

# 3. Build web
echo "  → 编译 Web UI..."
(cd "$WEB_DIR" && bun run build 2>&1 | tail -3)

# 4. Create .app bundle
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$SRC/Info.plist" "$APP/Contents/"
echo -n "APPL????" > "$APP/Contents/PkgInfo"

# 5. Bundle web dist
if [ -d "$WEB_DIR/dist" ]; then
    echo "  → 打包 Web UI 到 app bundle..."
    cp -r "$WEB_DIR/dist" "$APP/Contents/Resources/web-dist"
fi

# 6. Bundle daemon source (app spawns daemon at runtime)
echo "  → 打包 daemon..."
mkdir -p "$APP/Contents/Resources/daemon"
cp -r "$DAEMON_DIR/src" "$APP/Contents/Resources/daemon/src"
cp "$DAEMON_DIR/package.json" "$APP/Contents/Resources/daemon/"
cp -r "$DAEMON_DIR/node_modules" "$APP/Contents/Resources/daemon/node_modules" 2>/dev/null || true

# 7. Compile Swift
echo "  → 编译 Swift..."
swiftc \
    "$SRC/AppDelegate.swift" \
    "$SRC/main.swift" \
    -o "$APP/Contents/MacOS/Flock" \
    -framework Cocoa \
    -framework WebKit \
    -target arm64-apple-macos13.0 \
    -suppress-warnings

# 8. Sign
xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP"

echo "  ✓ $APP_NAME.app"
echo ""
echo "=== 完成 ==="
echo "启动：open \"$APP\""
echo "开发模式：\"$APP/Contents/MacOS/Flock\" --dev"
