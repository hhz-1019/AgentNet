# Build the pinned upstream checkout with entry/transport fixes, not a new
# ranking algorithm. Mirrors upstream cmd/gorse-in-one/Dockerfile.
FROM --platform=$BUILDPLATFORM golang:1.26 AS build
WORKDIR /src
COPY eigenflux/vendor/gorse/go.* ./
RUN go mod download
COPY eigenflux/vendor/gorse/ ./
COPY eigenflux/recommender/patches/ /tmp/patches/
RUN git apply --check /tmp/patches/*.patch && git apply /tmp/patches/*.patch
COPY eigenflux/recommender/upstream-tests/sqlite_cache_index_test.go ./storage/cache/elsewhere_sqlite_index_test.go
COPY eigenflux/recommender/upstream-tests/item_cache_metadata_test.go ./server/elsewhere_item_cache_test.go
RUN CGO_ENABLED=0 go test ./storage/cache ./server -run '^TestElsewhere(SQLiteItemIndex|ItemCacheMetadata)$' -count=1
ARG TARGETOS
ARG TARGETARCH
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} CGO_ENABLED=0 go build -ldflags="-X github.com/gorse-io/gorse/config.RootDir=/var/lib/gorse -X github.com/gorse-io/gorse/cmd/version.Version=v0.5.11-profile -X github.com/gorse-io/gorse/cmd/version.GitCommit=de9141d5d87236289d8d7f102bb9588234ff63cf" -o /gorse-in-one ./cmd/gorse-in-one
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /gorse-in-one /usr/bin/gorse-in-one
COPY eigenflux/recommender/gorse.toml /etc/gorse/config.toml
ENV USER=root
ENTRYPOINT ["/usr/bin/gorse-in-one", "-c", "/etc/gorse/config.toml"]
