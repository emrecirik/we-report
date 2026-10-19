package main

import (
	"encoding/json"
	"testing"
)

type testDialect struct{}

func (testDialect) quote(name string) string { return quoteDouble(name) }
func (testDialect) placeholder(int) string   { return "?" }

var testSchema = []table{{Name: "t", Columns: []column{{Name: "a"}, {Name: "b"}}}}

func build(t *testing.T, query string) (*built, *apiError) {
	t.Helper()
	var q structuredQuery
	if err := json.Unmarshal([]byte(query), &q); err != nil {
		t.Fatal(err)
	}
	return buildSelect(&q, testSchema, testDialect{}, nil, 100)
}

func TestGridQuery(t *testing.T) {
	b, err := build(t, `{"table":"t","columns":["a"],"distinct":true,"where":[{"column":"b","op":"contains","value":"5%_\\"}],"orderBy":[{"column":"a"}],"limit":10,"offset":20}`)
	if err != nil {
		t.Fatal(err)
	}
	want := `SELECT DISTINCT "a" FROM "t" WHERE LOWER("b") LIKE LOWER(?) ESCAPE '\' ORDER BY "a" ASC LIMIT 11 OFFSET 20`
	if b.sql != want {
		t.Errorf("sql\n got %s\nwant %s", b.sql, want)
	}
	if b.values[0] != `%5\%\_\\%` {
		t.Errorf("pattern %v", b.values[0])
	}
	if want := `SELECT COUNT(*) AS total FROM (SELECT DISTINCT "a" FROM "t" WHERE LOWER("b") LIKE LOWER(?) ESCAPE '\') AS we_report_c`; b.countSQL != want {
		t.Errorf("count\n got %s\nwant %s", b.countSQL, want)
	}
	if b, _ := build(t, `{"table":"t","where":[{"column":"a","op":"startsWith","value":"x"}]}`); b.values[0] != "x%" {
		t.Errorf("startsWith pattern %v", b.values[0])
	}
	for _, bad := range []string{`{"table":"t","offset":-1}`, `{"table":"t","offset":1.5}`, `{"table":"t","offset":"1"}`,
		`{"table":"t","distinct":"yes"}`, `{"table":"t","distinct":true}`} {
		if _, err := build(t, bad); err == nil || err.status != 400 {
			t.Errorf("%s: want 400, got %v", bad, err)
		}
	}
}
