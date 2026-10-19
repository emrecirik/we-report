package main

// Database drivers: SQLite (modernc.org/sqlite, pure Go) and PostgreSQL (pgx).

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type table struct {
	Name    string   `json:"name"`
	Columns []column `json:"columns"`
}

type dialect interface {
	quote(name string) string
	placeholder(n int) string
}

type database interface {
	dialect
	schema(ctx context.Context) ([]table, error)
	query(ctx context.Context, b *built, timeout time.Duration) ([]row, error)
}

var (
	numberType  = regexp.MustCompile(`INT|DEC|NUM|REAL|FLOA|DOUB|MONEY`)
	dateType    = regexp.MustCompile(`DATE|TIME`)
	stringType  = regexp.MustCompile(`CHAR|TEXT|CLOB|UUID`)
	errTimedOut = errors.New("timed out")
)

func typeOf(declared string) string {
	t := strings.ToUpper(declared)
	switch {
	case numberType.MatchString(t):
		return "number"
	case dateType.MatchString(t):
		return "date"
	case strings.Contains(t, "BOOL"):
		return "boolean"
	case stringType.MatchString(t):
		return "string"
	}
	return "unknown"
}

func quoteDouble(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }

// openDatabase connects lazily; nothing is opened until a request needs the connection.
func openDatabase(c *connectionConfig) (database, error) {
	switch c.Dialect {
	case "sqlite":
		return openSqlite(c)
	case "postgres":
		// Without a connect timeout an unreachable database would hang the request.
		db, err := sql.Open("pgx", withConnectTimeout(c.URL, max(1, c.TimeoutMs/1000)))
		if err != nil {
			return nil, err
		}
		schema := c.Schema
		if schema == "" {
			schema = "public"
		}
		return &postgres{db: db, schemaName: schema}, nil
	}
	return nil, fmt.Errorf("unsupported dialect %q", c.Dialect)
}

func withConnectTimeout(dsn string, seconds int) string {
	if strings.Contains(dsn, "connect_timeout") {
		return dsn
	}
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		return dsn + sep + "connect_timeout=" + strconv.Itoa(seconds)
	}
	return dsn + " connect_timeout=" + strconv.Itoa(seconds)
}

// ── SQLite ──────────────────────────────────────────────────────────────────

type sqlite struct{ db *sql.DB }

func openSqlite(c *connectionConfig) (database, error) {
	if c.Seed == "sample" {
		if _, err := os.Stat(c.URL); errors.Is(err, os.ErrNotExist) {
			if err := seedSqlite(c.URL); err != nil {
				return nil, err
			}
		}
	}
	// Read-only at the driver level: even an allowed free SQL statement cannot write.
	db, err := sql.Open("sqlite", "file:"+c.URL+"?mode=ro")
	if err != nil {
		return nil, err
	}
	return &sqlite{db}, nil
}

func seedSqlite(path string) error {
	script, err := findSeed()
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec(script)
	return err
}

// The sample dataset ships with the repository; the Docker image copies it next to the binary.
func findSeed() (string, error) {
	for _, p := range []string{os.Getenv("WE_REPORT_SEED"), "../../data/seed.sql", "seed.sql"} {
		if p == "" {
			continue
		}
		if b, err := os.ReadFile(p); err == nil {
			return string(b), nil
		}
	}
	return "", errors.New("samples/data/seed.sql not found; set WE_REPORT_SEED")
}

func (s *sqlite) quote(name string) string { return quoteDouble(name) }
func (s *sqlite) placeholder(int) string   { return "?" }

func (s *sqlite) schema(ctx context.Context) ([]table, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT m.name, p.name, p.type FROM sqlite_master m JOIN pragma_table_info(m.name) p
		WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid`)
	if err != nil {
		return nil, err
	}
	return groupColumns(rows)
}

func (s *sqlite) query(ctx context.Context, b *built, timeout time.Duration) ([]row, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	rows, err := s.db.QueryContext(ctx, b.sql, b.values...)
	if err != nil {
		return nil, timeoutOr(ctx, err)
	}
	return readRows(rows)
}

// ── PostgreSQL ──────────────────────────────────────────────────────────────

type postgres struct {
	db         *sql.DB
	schemaName string
}

func (p *postgres) quote(name string) string { return quoteDouble(name) }
func (p *postgres) placeholder(n int) string { return "$" + strconv.Itoa(n) }

func (p *postgres) schema(ctx context.Context) ([]table, error) {
	rows, err := p.db.QueryContext(ctx, `SELECT table_name, column_name, data_type FROM information_schema.columns
		WHERE table_schema = $1 ORDER BY table_name, ordinal_position`, p.schemaName)
	if err != nil {
		return nil, err
	}
	return groupColumns(rows)
}

func (p *postgres) query(ctx context.Context, b *built, timeout time.Duration) ([]row, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	// Read-only transaction with a statement timeout, always rolled back: defence in depth beside
	// the read-only database user.
	tx, err := p.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, timeoutOr(ctx, err)
	}
	defer tx.Rollback()
	for _, setup := range []string{
		fmt.Sprintf("SET LOCAL statement_timeout = %d", timeout.Milliseconds()),
		"SET LOCAL search_path = " + quoteDouble(p.schemaName),
	} {
		if _, err := tx.ExecContext(ctx, setup); err != nil {
			return nil, timeoutOr(ctx, err)
		}
	}
	rows, err := tx.QueryContext(ctx, b.sql, b.values...)
	if err != nil {
		return nil, timeoutOr(ctx, err)
	}
	return readRows(rows)
}

// ── Shared ──────────────────────────────────────────────────────────────────

func timeoutOr(ctx context.Context, err error) error {
	if ctx.Err() != nil || strings.Contains(err.Error(), "statement timeout") {
		return errTimedOut
	}
	return err
}

func groupColumns(rows *sql.Rows) ([]table, error) {
	defer rows.Close()
	var tables []table
	index := map[string]int{}
	for rows.Next() {
		var t, c string
		var declared sql.NullString
		if err := rows.Scan(&t, &c, &declared); err != nil {
			return nil, err
		}
		i, ok := index[t]
		if !ok {
			i = len(tables)
			index[t] = i
			tables = append(tables, table{Name: t})
		}
		tables[i].Columns = append(tables[i].Columns, column{c, typeOf(declared.String)})
	}
	return tables, rows.Err()
}

// row keeps its columns in query order (a Go map would not) when written as JSON.
type row struct {
	names  []string
	values []any
}

func (r row) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, name := range r.names {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(name)
		v, err := json.Marshal(r.values[i])
		if err != nil {
			return nil, err
		}
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// readRows returns JSON-friendly rows: numbers, text, booleans, dates as ISO text.
func readRows(rows *sql.Rows) ([]row, error) {
	defer rows.Close()
	names, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	types, _ := rows.ColumnTypes()
	out := []row{}
	for rows.Next() {
		cells := make([]any, len(names))
		ptrs := make([]any, len(names))
		for i := range cells {
			ptrs[i] = &cells[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		values := make([]any, len(names))
		for i := range names {
			kind := ""
			if types != nil {
				kind = strings.ToUpper(types[i].DatabaseTypeName())
			}
			values[i] = plain(cells[i], kind)
		}
		out = append(out, row{names, values})
	}
	return out, rows.Err()
}

func plain(v any, kind string) any {
	switch x := v.(type) {
	case []byte:
		// NUMERIC arrives as text from some drivers; binary columns are not reportable yet.
		if numberType.MatchString(kind) {
			if f, err := strconv.ParseFloat(string(x), 64); err == nil {
				return f
			}
		}
		if kind == "BLOB" || kind == "BYTEA" {
			return nil
		}
		return string(x)
	case string:
		if strings.Contains(kind, "NUMERIC") || strings.Contains(kind, "DECIMAL") {
			if f, err := strconv.ParseFloat(x, 64); err == nil {
				return f
			}
		}
		return x
	case time.Time:
		// Dates keep their calendar day: no time-zone shift.
		if kind == "DATE" {
			return x.Format("2006-01-02")
		}
		return x.Format("2006-01-02T15:04:05")
	}
	return v
}
