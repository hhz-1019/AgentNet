package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// Transport fixture only: returned order is deliberately supplied by the test,
// never computed by Elsewhere. Real upstream/model tests run separately.
func socialStubEngine(t *testing.T, ids func() []string) {
	t.Helper()
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/recommend/"):
			json.NewEncoder(w).Encode(ids())
		case strings.HasSuffix(r.URL.Path, "/feedback") && r.Method == "GET":
			fmt.Fprint(w, "[]")
		case strings.HasPrefix(r.URL.Path, "/api/user/") && r.Method == "GET":
			w.WriteHeader(404)
		default:
			fmt.Fprint(w, "{}")
		}
	}))
	t.Cleanup(engine.Close)
	t.Setenv("AGENTNET_GORSE_URL", engine.URL)
	t.Setenv("AGENTNET_GORSE_API_KEY", "fixture")
}

func TestSocialRecommendationFullNetworkCard(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name,bio) VALUES(9851,'角色不是用户','不能作为用户兴趣');
 INSERT INTO human_accounts VALUES('recommendation-owner','PRIVATE_PASSWORD','PRIVATE_RECOVERY',1);
 INSERT INTO agent_owners VALUES(9851,'recommendation-owner',1);
 INSERT INTO twin_users(user_id,current_goal,portrait_fields,created_at,last_active_at) VALUES('recommendation-owner','旧目标','{"bio":"在校学生","interests":"电影、英语、产品","offers":"能帮忙剪辑短片","recent":"PRIVATE_MEMORY","name":"PRIVATE_NAME"}',1,1);
 INSERT INTO agent_companions(agent_id,connection_goal,updated_at) VALUES(9851,'寻找远程实习；最后还有英语口语伙伴',1)`).Error)
	t.Cleanup(func() {
		db.Exec("DELETE FROM agent_companions WHERE agent_id=9851")
		db.Exec("DELETE FROM agent_owners WHERE agent_id=9851")
		db.Exec("DELETE FROM twin_users WHERE user_id='recommendation-owner'")
		db.Exec("DELETE FROM human_accounts WHERE uid='recommendation-owner'")
		db.Exec("DELETE FROM agents WHERE agent_id=9851")
	})
	service := &Service{db: db}
	got, err := service.recommendationProfile(context.Background(), 9851)
	check(err)
	for _, v := range []string{"在校学生", "电影、英语、产品", "能帮忙剪辑短片", "最后还有英语口语伙伴"} {
		if !strings.Contains(got, v) {
			t.Fatal("missing complete field", v, got)
		}
	}
	for _, v := range []string{"PRIVATE", "旧目标", "角色不是用户", "不能作为用户兴趣"} {
		if strings.Contains(got, v) {
			t.Fatal("wrong profile source", got)
		}
	}
	check(db.Exec("UPDATE agent_companions SET connection_goal='' WHERE agent_id=9851").Error)
	got, err = service.recommendationProfile(context.Background(), 9851)
	check(err)
	if strings.Contains(got, "旧目标") || strings.Contains(got, "远程实习") {
		t.Fatal("cleared owner intent resurrected", got)
	}
	// A late field survives intact; there is no token-prefix truncation.
	long := strings.Repeat("独立产品与研究经历。", 100) + "周末寻找英语口语伙伴"
	check(db.Exec("UPDATE twin_users SET portrait_fields=jsonb_set(portrait_fields,'{interests}',to_jsonb(?::text)) WHERE user_id='recommendation-owner'", long).Error)
	got, err = service.recommendationProfile(context.Background(), 9851)
	check(err)
	if !strings.Contains(got, "周末寻找英语口语伙伴") {
		t.Fatal("tail of profile lost")
	}
}
