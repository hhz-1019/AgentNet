package reranker

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// The only allowed local destination is the private Compose service. Never
// forward legacy provider credentials or follow redirects to a paid provider.
const localEndpoint = "http://local-ranker:8090/v1/rerank"

func (c *Client) rankLocal(ctx context.Context, req RerankRequest) (*RerankResponse, error) {
	if c.url != localEndpoint || len(req.Documents) > 500 || len(req.Query) > 12000 {
		return nil, fmt.Errorf("invalid local ranking configuration or input")
	}
	size := 0
	for _, document := range req.Documents {
		if len(document) > 4000 {
			return nil, fmt.Errorf("local document exceeds limit")
		}
		size += len(document)
	}
	if size > 2000000 {
		return nil, fmt.Errorf("local request exceeds limit")
	}
	client := *c
	client.authToken = ""
	transport := *c.httpClient
	transport.Timeout = 120 * time.Second
	transport.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	client.httpClient = &transport
	return client.rerankUnbudgeted(ctx, req)
}
