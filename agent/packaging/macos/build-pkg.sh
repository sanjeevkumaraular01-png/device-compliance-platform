#!/bin/bash
# Template: build a signed macOS installer package (.pkg) with pkgbuild/productbuild.
#   VERSION=1.0.0 ./packaging/macos/build-pkg.sh
# Requires the universal (or per-arch) binaries in ./bin and, for distribution,
# a "Developer ID Installer" certificate (SIGN_IDENTITY) + notarization.
set -euo pipefail
VERSION="${VERSION:-1.0.0}"
SIGN_IDENTITY="${SIGN_IDENTITY:-}"
ROOT="$(mktemp -d)"
SCRIPTS="$(mktemp -d)"
OUT="${OUT:-dist}"
trap 'rm -rf "$ROOT" "$SCRIPTS"' EXIT

mkdir -p "$ROOT/usr/local/bin" "$ROOT/Library/LaunchDaemons" "$OUT"
# Universal binary from both architectures.
lipo -create -output "$ROOT/usr/local/bin/sem-agent" bin/sem-agent-darwin-amd64 bin/sem-agent-darwin-arm64
chmod 0755 "$ROOT/usr/local/bin/sem-agent"
cp packaging/macos/com.secureendpoint.agent.plist "$ROOT/Library/LaunchDaemons/"

cat > "$SCRIPTS/postinstall" <<'EOF'
#!/bin/bash
mkdir -p /Library/Logs/SecureEndpoint
chown root:wheel /Library/LaunchDaemons/com.secureendpoint.agent.plist
chmod 0644 /Library/LaunchDaemons/com.secureendpoint.agent.plist
# Enrollment: deploy an MDM script that runs
#   /usr/local/bin/sem-agent enroll --server https://SERVER --token sem_enr_xxx
# The daemon is loaded only once the device is enrolled.
if [ -f "/Library/Application Support/SecureEndpoint/agent.json" ]; then
  launchctl bootout system/com.secureendpoint.agent 2>/dev/null || true
  launchctl bootstrap system /Library/LaunchDaemons/com.secureendpoint.agent.plist
fi
exit 0
EOF
chmod 0755 "$SCRIPTS/postinstall"

if [ -n "$SIGN_IDENTITY" ]; then
  codesign --force --options runtime --timestamp --sign "${APP_SIGN_IDENTITY:-$SIGN_IDENTITY}" "$ROOT/usr/local/bin/sem-agent" || true
fi

pkgbuild --root "$ROOT" --scripts "$SCRIPTS" --identifier com.secureendpoint.agent --version "$VERSION" \
  --install-location / "$OUT/sem-agent-$VERSION-component.pkg"
ARGS=(--package "$OUT/sem-agent-$VERSION-component.pkg" "$OUT/sem-agent-$VERSION.pkg")
[ -n "$SIGN_IDENTITY" ] && ARGS=(--sign "$SIGN_IDENTITY" "${ARGS[@]}")
productbuild "${ARGS[@]}"
rm -f "$OUT/sem-agent-$VERSION-component.pkg"
echo "built $OUT/sem-agent-$VERSION.pkg"
echo "notarize: xcrun notarytool submit $OUT/sem-agent-$VERSION.pkg --keychain-profile <profile> --wait && xcrun stapler staple $OUT/sem-agent-$VERSION.pkg"
