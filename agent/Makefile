# SecureEndpoint agent build.
VERSION ?= $(shell cat VERSION 2>/dev/null || echo 0.0.0-dev)
BIN     := bin
DIST    := dist/downloads
LDFLAGS := -s -w -X main.version=$(VERSION)
GOBUILD := CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)"
GOOS    ?= $(shell go env GOOS)
GOARCH  ?= $(shell go env GOARCH)
EXT     := $(if $(filter windows,$(GOOS)),.exe,)

export GOFLAGS := -buildvcs=false

.PHONY: all build build-all test lint vet fmt dist docker clean tidy

all: lint test build

## build: binary for the host platform -> bin/sem-agent-<os>-<arch>
build:
	$(GOBUILD) -o $(BIN)/sem-agent-$(GOOS)-$(GOARCH)$(EXT) ./cmd/sem-agent

## build-all: cross-compile the 6 release targets
build-all:
	@for t in windows/amd64 windows/arm64 linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do \
		os=$${t%/*}; arch=$${t#*/}; ext=""; [ $$os = windows ] && ext=.exe; \
		echo "==> $$os/$$arch"; \
		GOOS=$$os GOARCH=$$arch $(GOBUILD) -o $(BIN)/sem-agent-$$os-$$arch$$ext ./cmd/sem-agent || exit 1; \
	done

## test: unit tests
test:
	go test -count=1 ./...

## vet: go vet for every supported OS
vet:
	GOOS=linux   go vet ./...
	GOOS=windows go vet ./...
	GOOS=darwin  go vet ./...

## lint: gofmt + vet (+ staticcheck when installed)
lint: vet
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi
	@command -v staticcheck >/dev/null 2>&1 && staticcheck ./... || true

fmt:
	gofmt -w .

tidy:
	go mod tidy

## dist: binaries + install scripts + checksums.txt in dist/downloads
dist:
	VERSION=$(VERSION) OUT=$(DIST) BIN=$(BIN) sh scripts/build-dist.sh

## docker: build the downloads sidecar image
docker:
	docker build --build-arg VERSION=$(VERSION) -t sem-agent-dist:$(VERSION) .

clean:
	rm -rf $(BIN) dist
