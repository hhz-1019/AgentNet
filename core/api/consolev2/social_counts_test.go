package consolev2

import (
	"errors"
	"os"
	"testing"

	"gorm.io/gorm"
)

func TestSocialReactionCountsTransaction(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	db := socialFixtureDB(t, dsn)
	rollback := errors.New("rollback fixture")
	err := db.Transaction(func(tx *gorm.DB) error {
		check := func(err error) {
			t.Helper()
			if err != nil {
				t.Fatal(err)
			}
		}
		check(tx.Exec("INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,approved_revision) VALUES(88901,1,'published','public','{}',1,1)").Error)
		counts := func(likes, saves int64) {
			t.Helper()
			var row struct{ LikeCount, SaveCount int64 }
			check(tx.Raw("SELECT like_count,save_count FROM social_work_posts WHERE post_id=88901").Scan(&row).Error)
			if row.LikeCount != likes || row.SaveCount != saves {
				t.Fatalf("counts %+v, want %d/%d", row, likes, saves)
			}
		}
		check(tx.Exec("INSERT INTO social_work_reactions VALUES(88901,2,'like') ON CONFLICT DO NOTHING").Error)
		check(tx.Exec("INSERT INTO social_work_reactions VALUES(88901,2,'like') ON CONFLICT DO NOTHING").Error)
		counts(1, 0)
		check(tx.Exec("SAVEPOINT reaction_change").Error)
		check(tx.Exec("UPDATE social_work_reactions SET kind='save' WHERE post_id=88901").Error)
		counts(0, 1)
		check(tx.Exec("ROLLBACK TO SAVEPOINT reaction_change").Error)
		counts(1, 0)
		check(tx.Exec("DELETE FROM social_work_reactions WHERE post_id=88901").Error)
		counts(0, 0)
		check(tx.Exec("INSERT INTO social_work_reactions VALUES(88901,2,'save')").Error)
		check(tx.Exec("TRUNCATE social_work_reactions").Error)
		counts(0, 0)
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
}
