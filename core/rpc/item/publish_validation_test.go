package main

import (
	"context"
	"strings"
	"testing"

	"elsewhere_server/kitex_gen/elsewhere/item"
	"elsewhere_server/pkg/validator"
)

func TestPublishItemRejectsOversizedContentBeforePersistence(t *testing.T) {
	svc := &ItemServiceImpl{}
	resp, err := svc.PublishItem(context.Background(), &item.PublishItemReq{
		AuthorAgentId: 1,
		RawContent:    strings.Repeat("a", validator.MaxBroadcastContentLength+1),
	})
	if err != nil {
		t.Fatalf("PublishItem error: %v", err)
	}
	if resp.BaseResp == nil || resp.BaseResp.Code != 400 {
		t.Fatalf("response = %+v, want code 400", resp)
	}
}
