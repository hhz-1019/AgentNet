# Build pinned Gorse with local hybrid ranking and disabled-by-default paid calls.
FROM --platform=$BUILDPLATFORM golang:1.26 AS build
WORKDIR /src
COPY elsewhere/vendor/gorse/go.* ./
RUN go mod download
COPY elsewhere/vendor/gorse/ ./
COPY elsewhere/recommender/patches/ /tmp/patches/
RUN git apply /tmp/patches/*.patch
COPY elsewhere/recommender/overlay/ ./
COPY elsewhere/recommender/upstream-tests/sqlite_cache_index_test.go ./storage/cache/elsewhere_sqlite_index_test.go
COPY elsewhere/recommender/upstream-tests/item_cache_metadata_test.go ./server/elsewhere_item_cache_test.go
COPY elsewhere/recommender/upstream-tests/ranking_cache_test.go ./worker/elsewhere_ranking_cache_test.go
RUN CGO_ENABLED=0 go test ./common/reranker && CGO_ENABLED=0 go test ./worker -run 'TestWorker/TestElsewhere' -count=1 && CGO_ENABLED=0 go test ./storage/cache ./server -run '^TestElsewhere(SQLiteItemIndex|ItemCacheMetadata)$' -count=1
ARG TARGETOS
ARG TARGETARCH
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} CGO_ENABLED=0 go build -ldflags="-X github.com/gorse-io/gorse/config.RootDir=/var/lib/gorse -X github.com/gorse-io/gorse/cmd/version.Version=v0.5.11-profile -X github.com/gorse-io/gorse/cmd/version.GitCommit=de9141d5d87236289d8d7f102bb9588234ff63cf" -o /gorse-in-one ./cmd/gorse-in-one
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /gorse-in-one /usr/bin/gorse-in-one
COPY elsewhere/recommender/gorse.toml /etc/gorse/config.toml
ENV USER=root
ENV RERANKER_MODE=local RERANKER_DAILY_CALL_LIMIT=0 RERANKER_DAILY_TOKEN_LIMIT=0 RERANKER_BUDGET_DB=/var/lib/gorse/ranking-guard.db
ENTRYPOINT ["/usr/bin/gorse-in-one", "-c", "/etc/gorse/config.toml"]
