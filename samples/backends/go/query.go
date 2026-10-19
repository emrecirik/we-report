package main

// Turns the protocol's structured query into SQL. Every identifier is checked against the
// introspected schema and quoted by the dialect; every value is a bound parameter.

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

// apiError is an error whose message is safe to show to the caller.
type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string { return e.message }

func fail(status int, format string, args ...any) *apiError {
	return &apiError{status, fmt.Sprintf(format, args...)}
}

type built struct {
	sql    string
	values []any
	limit  int
}

type condition struct {
	Column any     `json:"column"`
	Op     any     `json:"op"`
	Value  any     `json:"value"`
	Param  *string `json:"param"`
}

type order struct {
	Column any `json:"column"`
	Dir    any `json:"dir"`
}

type structuredQuery struct {
	Table   any         `json:"table"`
	Columns []any       `json:"columns"`
	Where   []condition `json:"where"`
	OrderBy []order     `json:"orderBy"`
	Limit   any         `json:"limit"`
}

const maxInValues = 1000

var ops = map[string]bool{"=": true, "!=": true, "<": true, "<=": true, ">": true, ">=": true, "like": true, "in": true, "isNull": true, "notNull": true}

// driverValue keeps request values to text, numbers and nil; whole numbers stay integers.
func driverValue(v any) (any, *apiError) {
	switch x := v.(type) {
	case nil, string:
		return x, nil
	case float64:
		if x == math.Trunc(x) && math.Abs(x) < 1<<53 {
			return int64(x), nil
		}
		return x, nil
	case bool:
		if x {
			return int64(1), nil
		}
		return int64(0), nil
	}
	return nil, fail(400, "Query values must be text, numbers, booleans or null.")
}

func buildSelect(q *structuredQuery, schema []table, d dialect, params map[string]any, maxRows int) (*built, *apiError) {
	if q == nil {
		return nil, fail(400, "query must be an object.")
	}
	var t *table
	for i := range schema {
		if schema[i].Name == q.Table {
			t = &schema[i]
		}
	}
	if t == nil {
		return nil, fail(400, "Unknown table \"%v\".", q.Table)
	}
	known := map[string]bool{}
	for _, c := range t.Columns {
		known[c.Name] = true
	}
	column := func(name any) (string, *apiError) {
		s, ok := name.(string)
		if !ok || !known[s] {
			return "", fail(400, "Unknown column \"%v\" in \"%s\".", name, t.Name)
		}
		return d.quote(s), nil
	}
	var values []any
	bind := func(v any) (string, *apiError) {
		dv, err := driverValue(v)
		if err != nil {
			return "", err
		}
		values = append(values, dv)
		return d.placeholder(len(values)), nil
	}

	var columns []string
	if len(q.Columns) > 0 {
		for _, c := range q.Columns {
			col, err := column(c)
			if err != nil {
				return nil, err
			}
			columns = append(columns, col)
		}
	} else {
		for _, c := range t.Columns {
			columns = append(columns, d.quote(c.Name))
		}
	}

	var conditions []string
	for _, w := range q.Where {
		op, _ := w.Op.(string)
		if !ops[op] {
			return nil, fail(400, "Unsupported operator \"%v\".", w.Op)
		}
		col, err := column(w.Column)
		if err != nil {
			return nil, err
		}
		value := w.Value
		if w.Param != nil {
			value = params[*w.Param]
		}
		switch op {
		case "isNull":
			conditions = append(conditions, col+" IS NULL")
		case "notNull":
			conditions = append(conditions, col+" IS NOT NULL")
		case "in":
			list, ok := value.([]any)
			if !ok || len(list) == 0 || len(list) > maxInValues {
				return nil, fail(400, "\"in\" needs a list of 1-%d values.", maxInValues)
			}
			marks := make([]string, len(list))
			for i, v := range list {
				if marks[i], err = bind(v); err != nil {
					return nil, err
				}
			}
			conditions = append(conditions, col+" IN ("+strings.Join(marks, ", ")+")")
		default:
			mark, err := bind(value)
			if err != nil {
				return nil, err
			}
			sqlOp := map[string]string{"!=": "<>", "like": "LIKE"}[op]
			if sqlOp == "" {
				sqlOp = op
			}
			conditions = append(conditions, col+" "+sqlOp+" "+mark)
		}
	}

	var orderBy []string
	for _, o := range q.OrderBy {
		if o.Dir != nil && o.Dir != "asc" && o.Dir != "desc" {
			return nil, fail(400, "orderBy.dir must be asc or desc.")
		}
		col, err := column(o.Column)
		if err != nil {
			return nil, err
		}
		dir := "ASC"
		if o.Dir == "desc" {
			dir = "DESC"
		}
		orderBy = append(orderBy, col+" "+dir)
	}

	limit := maxRows
	if l, ok := q.Limit.(float64); ok && l > 0 && l == math.Trunc(l) && int(l) < maxRows {
		limit = int(l)
	}
	where, sort := "", ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}
	if len(orderBy) > 0 {
		sort = " ORDER BY " + strings.Join(orderBy, ", ")
	}
	// One extra row tells us whether the result was truncated.
	sql := fmt.Sprintf("SELECT %s FROM %s%s%s LIMIT %d", strings.Join(columns, ", "), d.quote(t.Name), where, sort, limit+1)
	return &built{sql, values, limit}, nil
}

// Standard strings, quoted and [bracketed] identifiers, comments — matched left to right — and
// :name parameters. RE2 has no look-behind, so the character before a parameter is checked by hand.
var (
	literalsOrParams = regexp.MustCompile(`'(?:[^']|'')*'|"(?:[^"]|"")*"|\[[^\]]*\]|--[^\n]*|/\*[\s\S]*?\*/|:([A-Za-z_]\w*)`)
	literals         = regexp.MustCompile(`'(?:[^']|'')*'|"(?:[^"]|"")*"|\[[^\]]*\]|--[^\n]*|/\*[\s\S]*?\*/`)
	trailingSemi     = regexp.MustCompile(`;\s*$`)
	escapes          = regexp.MustCompile(`\\|\$[A-Za-z_]*\$`)
	selectStart      = regexp.MustCompile(`(?i)^\s*(select|with)\b`)
	wordChar         = regexp.MustCompile(`[\w:]`)
)

// buildFreeSQL accepts one SELECT statement with :name parameters and wraps it in a row limit.
func buildFreeSQL(sql string, d dialect, params map[string]any, maxRows int) (*built, *apiError) {
	if strings.TrimSpace(sql) == "" {
		return nil, fail(400, "sql must be a non-empty string.")
	}
	body := trailingSemi.ReplaceAllString(strings.TrimSpace(sql), "")
	// Backslash escapes (Postgres E'..') and dollar quoting change where a string ends in ways the
	// stripper cannot follow, which could hide a second statement. Report SQL never needs them.
	if escapes.MatchString(body) {
		return nil, fail(400, "Free SQL cannot contain backslashes or dollar-quoted strings.")
	}
	bare := literals.ReplaceAllString(body, "''")
	if strings.Contains(bare, ";") {
		return nil, fail(400, "Only one SQL statement is allowed.")
	}
	if !selectStart.MatchString(bare) {
		return nil, fail(400, "Only SELECT queries are allowed.")
	}
	var values []any
	var out strings.Builder
	last := 0
	for _, m := range literalsOrParams.FindAllStringSubmatchIndex(body, -1) {
		// A literal or comment, or a "::cast" / "a:b" that only looks like a parameter: kept.
		if m[2] < 0 || (m[0] > 0 && wordChar.MatchString(body[m[0]-1:m[0]])) {
			continue
		}
		v, err := driverValue(params[body[m[2]:m[3]]])
		if err != nil {
			return nil, err
		}
		values = append(values, v)
		out.WriteString(body[last:m[0]])
		out.WriteString(d.placeholder(len(values)))
		last = m[1]
	}
	out.WriteString(body[last:])
	return &built{fmt.Sprintf("SELECT * FROM (%s) AS we_report_q LIMIT %d", out.String(), maxRows+1), values, maxRows}, nil
}
