package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestElsewhereImagePreviewOwnership(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("requires isolated social PostgreSQL fixture")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name) VALUES(88401,'预览主人'),(88402,'另一位主人')`).Error)
	defer db.Exec(`DELETE FROM agents WHERE agent_id IN(88401,88402)`)
	check(db.Exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at) VALUES(88403,88401,decode(?,'base64'),'image/png',1)`, base64.StdEncoding.EncodeToString(previewTestImage(t, 120, 80))).Error)
	defer db.Exec(`DELETE FROM social_media WHERE media_id=88403`)
	d := socialTestDocument()
	d.Media = []socialMedia{{URL: socialMediaPrefix + "88403", Kind: "image", Alt: "预览", Width: 999, Preview: "forged"}}
	b, _ := json.Marshal(d)
	rows := []socialPostRow{{AgentID: 88401, Document: string(b)}, {AgentID: 88402, Document: string(b)}}
	s := &Service{db: db}
	// A cold list may omit previews until the background job finishes, but it
	// must never decode originals as a side effect of reading the list.
	s.addSocialImagePreviews(context.Background(), rows)
	var untouched bool
	check(db.Raw(`SELECT preview IS NULL FROM social_media WHERE media_id=88403`).Scan(&untouched).Error)
	if !untouched {
		t.Fatal("feed read processed an original")
	}
	for {
		worked, err := s.prepareNextMedia(context.Background())
		check(err)
		if !worked {
			break
		}
	}
	for run := 0; run < 2; run++ { // Includes the cached path, with owner check intact.
		s.addSocialImagePreviews(context.Background(), rows)
		for i, row := range rows {
			var got socialDocument
			if err := json.Unmarshal([]byte(row.Document), &got); err != nil {
				t.Fatal(err)
			}
			m := got.Media[0]
			if i == 0 && (m.Width != 120 || m.Height != 80 || m.Color != "#2878b4" || !strings.HasPrefix(m.Preview, "data:image/jpeg;base64,")) {
				t.Fatalf("missing preview: %+v", m)
			}
			if i == 1 && (m.Width != 0 || m.Height != 0 || m.Preview != "" || m.Color != "") {
				t.Fatalf("another owner's image leaked: %+v", m)
			}
		}
	}
	guest := guestView(rows[0], false)
	if guest.Document.Media[0].Preview == "" || guest.Document.Media[0].URL == d.Media[0].URL {
		t.Fatal("guest URL rewrite dropped preview or exposed console URL")
	}
}
