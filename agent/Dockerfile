# Builds sem-agent for all 6 targets and packages the Nginx /downloads/ content.
#
#   docker build --build-arg VERSION=1.0.0 -t sem-agent-dist:1.0.0 .
#   docker run --rm -v sem-downloads:/out sem-agent-dist:1.0.0   # copies /downloads/* to /out and exits
#
# Used as an init/sidecar container (docker-compose / Kubernetes initContainer)
# to populate the volume Nginx serves at https://SERVER/downloads/.

FROM golang:1.23 AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-buildvcs=false GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=1.0.0
ARG SKIP_TESTS=0
RUN if [ "$SKIP_TESTS" != "1" ]; then \
      go vet ./... && GOOS=windows go vet ./... && GOOS=darwin go vet ./... && go test -count=1 ./... ; \
    fi
RUN VERSION="$VERSION" OUT=/downloads BIN=/tmp/bin sh scripts/build-dist.sh

FROM busybox:1.38
LABEL org.opencontainers.image.title="sem-agent-dist" \
      org.opencontainers.image.description="SecureEndpoint agent binaries and install scripts for the /downloads/ volume"
COPY --from=build /downloads /downloads
VOLUME ["/out"]
CMD ["sh", "-c", "mkdir -p /out && cp -f /downloads/* /out/ && echo \"sem-agent $(cat /downloads/VERSION) copied to /out\" && ls -l /out"]
