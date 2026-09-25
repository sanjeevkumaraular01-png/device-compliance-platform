#!/bin/sh
# Cross-compiles sem-agent for all supported targets and assembles the Nginx
# /downloads/ directory (binaries + install scripts + checksums.txt).
#   VERSION=1.2.3 OUT=dist/downloads ./scripts/build-dist.sh
set -eu

VERSION="${VERSION:-$(cat VERSION 2>/dev/null || echo 0.0.0-dev)}"
OUT="${OUT:-dist/downloads}"
BIN="${BIN:-bin}"
TARGETS="${TARGETS:-windows/amd64 windows/arm64 linux/amd64 linux/arm64 darwin/amd64 darwin/arm64}"

mkdir -p "$BIN" "$OUT"
for t in $TARGETS; do
  os="${t%/*}"
  arch="${t#*/}"
  ext=""
  [ "$os" = "windows" ] && ext=".exe"
  name="sem-agent-$os-$arch$ext"
  echo "building $name ($VERSION)"
  GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=$VERSION" -o "$BIN/$name" ./cmd/sem-agent
  cp "$BIN/$name" "$OUT/$name"
done

cp packaging/windows/install.ps1   "$OUT/install.ps1"
cp packaging/windows/uninstall.ps1 "$OUT/uninstall.ps1"
cp packaging/linux/install.sh      "$OUT/install.sh"
cp packaging/linux/uninstall.sh    "$OUT/uninstall.sh"
cp packaging/macos/install.sh      "$OUT/install-macos.sh"
cp packaging/macos/uninstall.sh    "$OUT/uninstall-macos.sh"
chmod 0644 "$OUT"/*.ps1
chmod 0755 "$OUT"/*.sh "$OUT"/sem-agent-linux-* "$OUT"/sem-agent-darwin-* 2>/dev/null || true

(
  cd "$OUT"
  rm -f checksums.txt
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum sem-agent-* install.ps1 install.sh install-macos.sh uninstall.ps1 uninstall.sh uninstall-macos.sh > checksums.txt.tmp
  else
    shasum -a 256 sem-agent-* install.ps1 install.sh install-macos.sh uninstall.ps1 uninstall.sh uninstall-macos.sh > checksums.txt.tmp
  fi
  mv checksums.txt.tmp checksums.txt
)
echo "$VERSION" > "$OUT/VERSION"
echo "dist ready in $OUT:"
ls -l "$OUT"
