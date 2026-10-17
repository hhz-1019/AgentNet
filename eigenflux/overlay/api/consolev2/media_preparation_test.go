package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"image"
	"os"
	"testing"
)

func TestSocialPreparedMediaPersistenceAndRevocation(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec("INSERT INTO agents(agent_id,agent_name) VALUES(88701,'性能测试')").Error)
	defer db.Exec("DELETE FROM agents WHERE agent_id=88701")
	check(insertPreparedMedia(db, 88702, 88701, previewTestImage(t, 1280, 854), "image/png"))
	defer db.Exec("DELETE FROM social_media WHERE media_id=88702")
	s := &Service{db: db}
	for {
		worked, err := s.prepareNextMedia(context.Background())
		check(err)
		if !worked {
			break
		}
	}
	var count int64
	check(db.Raw("SELECT count(*) FROM social_media_variants WHERE media_id=88702").Scan(&count).Error)
	if count < 1 {
		t.Fatal("derivatives not persisted")
	}
	d := socialTestDocument()
	d.Media = []socialMedia{{URL: socialMediaPrefix + "88702", Kind: "image", Alt: "封面"}}
	b, _ := json.Marshal(d)
	check(db.Exec("INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision) VALUES(88703,88701,'published','public',?::jsonb,1,1,1)", string(b)).Error)
	defer db.Exec("DELETE FROM social_work_posts WHERE post_id=88703")
	h := server.New()
	h.GET("/posts/:post_id/media/:index", s.getGuestMedia)
	first := ut.PerformRequest(h.Engine, "GET", "/posts/88703/media/0?w=320", nil).Result()
	if first.StatusCode() != 200 {
		t.Fatalf("image status %d", first.StatusCode())
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(first.Body()))
	check(err)
	if cfg.Width != 320 {
		t.Fatal("did not serve persisted derivative")
	}
	etag := string(first.Header.Peek("ETag"))
	second := ut.PerformRequest(h.Engine, "GET", "/posts/88703/media/0?w=320", nil, ut.Header{Key: "If-None-Match", Value: etag}).Result()
	if second.StatusCode() != 304 || len(second.Body()) != 0 {
		t.Fatal("validator did not avoid transfer")
	}
	check(db.Exec("UPDATE social_work_posts SET visibility='private' WHERE post_id=88703").Error)
	revoked := ut.PerformRequest(h.Engine, "GET", "/posts/88703/media/0?w=320", nil, ut.Header{Key: "If-None-Match", Value: etag}).Result()
	if revoked.StatusCode() != 404 {
		t.Fatal("cached derivative bypassed revoked permission")
	}
	// Response helper has no dependency on a warm process cache.
	mediaVariants.Lock()
	mediaVariants.values = map[string]mediaVariant{}
	mediaVariants.order = nil
	mediaVariants.bytes = 0
	mediaVariants.Unlock()
	h.GET("/owner", func(ctx context.Context, c *app.RequestContext) {
		data, mime, unchanged, err := s.preparedMediaResponse(ctx, c, 88702)
		if err != nil {
			c.Status(500)
		} else if !unchanged {
			c.Data(200, mime, data)
		}
	})
	restored := ut.PerformRequest(h.Engine, "GET", "/owner?w=320", nil).Result()
	if !bytes.Equal(first.Body(), restored.Body()) {
		t.Fatal("restart changed persisted derivative")
	}
}
