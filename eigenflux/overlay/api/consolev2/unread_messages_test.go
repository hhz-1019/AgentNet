package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestElsewhereUnreadSummary(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := socialFixtureDB(t, dsn)
	exec := func(sql string) {
		t.Helper()
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO agents(agent_id,agent_name) VALUES(88501,'A'),(88502,'B'),(88503,'C');
	 INSERT INTO conversations(conv_id,participant_a,participant_b,initiator_id,last_sender_id,msg_count,updated_at) VALUES(88501,88501,88502,88501,88501,1,1);
	 INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at) VALUES(88501,88501,88501,88502,'hello',1);
	 INSERT INTO social_groups VALUES(88501,'group',88501,1,1);
	 INSERT INTO social_group_members VALUES(88501,88501,0),(88501,88502,0);`)
	defer exec(`DELETE FROM user_relations WHERE from_uid IN(88501,88502,88503);
	 DELETE FROM social_group_messages WHERE group_id=88501; DELETE FROM social_group_members WHERE group_id=88501;
	 DELETE FROM social_groups WHERE group_id=88501; DELETE FROM conversations WHERE conv_id=88501;
	 DELETE FROM agents WHERE agent_id IN(88501,88502,88503);`)
	s := &Service{db: db}
	h := server.New()
	h.GET("/unread", func(ctx context.Context, c *app.RequestContext) {
		viewer, _ := strconv.ParseInt(c.Query("viewer"), 10, 64)
		c.Set("agent_id", viewer)
		s.getUnreadMessages(ctx, c)
	})
	check := func(viewer string, want bool) {
		t.Helper()
		r := ut.PerformRequest(h.Engine, "GET", "/unread?viewer="+viewer, nil)
		var body struct{ Data struct{ Unread bool } }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &body) != nil || body.Data.Unread != want {
			t.Fatalf("viewer=%s want=%v status=%d body=%s", viewer, want, r.Code, r.Body.String())
		}
	}
	check("88501", false) // Own outgoing message.
	check("88502", true)
	check("88503", false) // Neither participant nor member.
	exec(`UPDATE conversations SET status=1 WHERE conv_id=88501`)
	check("88502", false)
	exec(`UPDATE conversations SET status=0 WHERE conv_id=88501; UPDATE private_messages SET is_read=true WHERE msg_id=88501;
	 INSERT INTO social_group_messages VALUES(88502,88501,88501,'human','group message',2);`)
	check("88501", false)
	check("88502", true)
	check("88503", false)
	exec(`INSERT INTO user_relations VALUES(88502,88501,2)`)
	check("88502", false)
	exec(`DELETE FROM user_relations WHERE from_uid=88502 AND to_uid=88501; INSERT INTO user_relations VALUES(88501,88502,2)`)
	check("88502", false)
	exec(`DELETE FROM user_relations WHERE from_uid=88501 AND to_uid=88502; UPDATE social_group_members SET read_message_id=88502 WHERE group_id=88501 AND agent_id=88502`)
	check("88502", false)
	exec(`INSERT INTO social_group_messages VALUES(88503,88501,88501,'human','newer',3)`)
	check("88502", true)
}
