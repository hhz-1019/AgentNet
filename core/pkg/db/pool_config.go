package db

import (
	"database/sql"
	"os"
	"strconv"
	"time"
)

// The bundled Core starts ten database-using processes against one PostgreSQL
// server (currently max_connections=100). Budget connections across processes,
// leaving room for migrations, administration and transient workers.
func configurePool(pool *sql.DB) {
	open := poolInteger("PG_MAX_OPEN_CONNS", 8, 1, 100)
	idle := min(open, poolInteger("PG_MAX_IDLE_CONNS", 2, 0, 100))
	pool.SetMaxOpenConns(open)
	pool.SetMaxIdleConns(idle)
	pool.SetConnMaxIdleTime(time.Duration(poolInteger("PG_CONN_IDLE_SECONDS", 60, 1, 3600)) * time.Second)
	pool.SetConnMaxLifetime(time.Duration(poolInteger("PG_CONN_LIFETIME_SECONDS", 1800, 60, 86400)) * time.Second)
}

func poolInteger(name string, fallback, low, high int) int {
	n, err := strconv.Atoi(os.Getenv(name))
	if err != nil || n < low || n > high {
		return fallback
	}
	return n
}
