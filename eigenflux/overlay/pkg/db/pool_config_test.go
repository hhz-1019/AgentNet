package db

import (
	"database/sql"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPoolBudget(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int
	}{
		{"", 8}, {"12", 12}, {"0", 8}, {"-1", 8}, {"bad", 8}, {"101", 8},
	} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv("PG_MAX_OPEN_CONNS", tc.value)
			t.Setenv("PG_MAX_IDLE_CONNS", "100")
			pool, err := sql.Open("pgx", "host=127.0.0.1 port=1")
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			configurePool(pool)
			if pool.Stats().MaxOpenConnections != tc.want {
				t.Fatal(pool.Stats())
			}
		})
	}
}
