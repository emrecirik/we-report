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
	// The same rows without order, offset and limit, counted when the caller asks for `total`.
	countSQL string
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
	Nulls  any `json:"nulls"`
}

// search (1.2): every word of Text in some of Columns.
type search struct {
	Text    any   `json:"text"`
	Columns []any `json:"columns"`
}

// aggregate (1.2): a subtotal per group, returned under As.
type aggregate struct {
	Column any `json:"column"`
	Fn     any `json:"fn"`
	As     any `json:"as"`
}

type structuredQuery struct {
	Table      any         `json:"table"`
	Columns    []any       `json:"columns"`
	Where      []condition `json:"where"`
	OrderBy    []order     `json:"orderBy"`
	Limit      any         `json:"limit"`
	Offset     any         `json:"offset"`
	Distinct   any         `json:"distinct"`
	Search     *search     `json:"search"`
	GroupBy    []any       `json:"groupBy"`
	Aggregates []aggregate `json:"aggregates"`
}

const maxInValues = 1000
const maxSearchWords = 10

var aggregates = map[string]bool{"sum": true, "avg": true, "min": true, "max": true, "count": true}

// alias: a plain identifier not starting with __ (RE2 has no look-ahead, so __ is checked apart).
var alias = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

var ops = map[string]bool{"=": true, "!=": true, "<": true, "<=": true, ">": true, ">=": true, "like": true, "contains": true, "startsWith": true, "in": true, "isNull": true, "notNull": true}

// likeLiteral makes LIKE's wildcards and the escape character match themselves.
var likeLiteral = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`)

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

	if _, ok := q.Distinct.(bool); q.Distinct != nil && !ok {
		return nil, fail(400, "distinct must be true or false.")
	}
	distinct := q.Distinct == true
	if distinct && len(q.Columns) == 0 {
		return nil, fail(400, "distinct needs the columns to return.")
	}
	offset := 0
	if q.Offset != nil {
		o, ok := q.Offset.(float64)
		if !ok || o < 0 || o != math.Trunc(o) || o > math.MaxInt32 {
			return nil, fail(400, "offset must be a whole number of 0 or more.")
		}
		offset = int(o)
	}

	// 1.2 groups: one row per combination of the groupBy columns, with its count and subtotals
	// JSON leaves a missing list nil and an empty one non-nil: [] is an error, no groupBy is not
	grouped := q.GroupBy != nil
	var groupCols []string
	if grouped {
		seen := map[string]bool{}
		for _, g := range q.GroupBy {
			s, _ := g.(string)
			if seen[s] {
				return nil, fail(400, "groupBy must list 1-8 different columns.")
			}
			seen[s] = true
		}
		if len(q.GroupBy) == 0 || len(q.GroupBy) > 8 {
			return nil, fail(400, "groupBy must list 1-8 different columns.")
		}
		if len(q.Columns) > 0 || distinct || offset > 0 {
			return nil, fail(400, "groupBy does not go with columns, distinct or offset.")
		}
		for _, g := range q.GroupBy {
			col, err := column(g)
			if err != nil {
				return nil, err
			}
			groupCols = append(groupCols, col)
		}
	}
	if q.Aggregates != nil && !grouped {
		return nil, fail(400, "aggregates need groupBy.")
	}
	if len(q.Aggregates) > 32 {
		return nil, fail(400, "aggregates must be a list of at most 32.")
	}
	var aggregateCols []string
	names := map[string]bool{}
	for _, a := range q.Aggregates {
		fn, _ := a.Fn.(string)
		if !aggregates[fn] {
			return nil, fail(400, "Unsupported aggregate \"%v\".", a.Fn)
		}
		name, _ := a.As.(string)
		if !alias.MatchString(name) || strings.HasPrefix(name, "__") {
			return nil, fail(400, "Aggregate name \"%v\" must be a plain identifier not starting with __.", a.As)
		}
		if names[name] {
			return nil, fail(400, "Aggregate names must be different.")
		}
		names[name] = true
		col, err := column(a.Column)
		if err != nil {
			return nil, err
		}
		aggregateCols = append(aggregateCols, strings.ToUpper(fn)+"("+col+") AS "+d.quote(name))
	}

	var columns []string
	if grouped {
		columns = append(append(append(columns, groupCols...), "COUNT(*) AS "+d.quote("__count")), aggregateCols...)
	} else if len(q.Columns) > 0 {
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
		case "contains", "startsWith":
			text := ""
			if value != nil {
				text = fmt.Sprint(value)
			}
			pattern := likeLiteral.Replace(text) + "%"
			if op == "contains" {
				pattern = "%" + pattern
			}
			mark, err := bind(pattern)
			if err != nil {
				return nil, err
			}
			conditions = append(conditions, "LOWER("+col+") LIKE LOWER("+mark+") ESCAPE '\\'")
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

	// 1.2 search: every word in some column, read as text — AND across words, OR across columns
	if q.Search != nil {
		text, ok := q.Search.Text.(string)
		if !ok || len([]rune(text)) > 200 || len(q.Search.Columns) == 0 || len(q.Search.Columns) > 50 {
			return nil, fail(400, "search needs text (at most 200 characters) and 1-50 columns.")
		}
		var searched []string
		for _, c := range q.Search.Columns {
			col, err := column(c)
			if err != nil {
				return nil, err
			}
			searched = append(searched, col)
		}
		words := strings.Fields(text)
		if len(words) > maxSearchWords {
			words = words[:maxSearchWords]
		}
		for _, word := range words {
			var either []string
			for _, col := range searched {
				mark, err := bind("%" + likeLiteral.Replace(word) + "%")
				if err != nil {
					return nil, err
				}
				either = append(either, "LOWER(CAST("+col+" AS TEXT)) LIKE LOWER("+mark+") ESCAPE '\\'")
			}
			conditions = append(conditions, "("+strings.Join(either, " OR ")+")")
		}
	}

	// Groups come in groupBy order, NULL first, unless the caller orders them
	orders := q.OrderBy
	if orders == nil && grouped {
		for _, g := range q.GroupBy {
			orders = append(orders, order{Column: g, Nulls: "first"})
		}
	}
	var orderBy []string
	for _, o := range orders {
		if o.Dir != nil && o.Dir != "asc" && o.Dir != "desc" {
			return nil, fail(400, "orderBy.dir must be asc or desc.")
		}
		if o.Nulls != nil && o.Nulls != "first" && o.Nulls != "last" {
			return nil, fail(400, "orderBy.nulls must be first or last.")
		}
		col, err := column(o.Column)
		if err != nil {
			return nil, err
		}
		dir := "ASC"
		if o.Dir == "desc" {
			dir = "DESC"
		}
		switch o.Nulls {
		// CASE rather than NULLS FIRST/LAST: every dialect has it (MySQL and SQL Server have no NULLS clause)
		case "first":
			orderBy = append(orderBy, "CASE WHEN "+col+" IS NULL THEN 0 ELSE 1 END, "+col+" "+dir)
		case "last":
			orderBy = append(orderBy, "CASE WHEN "+col+" IS NULL THEN 1 ELSE 0 END, "+col+" "+dir)
		default:
			orderBy = append(orderBy, col+" "+dir)
		}
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
	keyword := "SELECT "
	if distinct {
		keyword = "SELECT DISTINCT "
	}
	rows := keyword + strings.Join(columns, ", ") + " FROM " + d.quote(t.Name) + where
	if grouped {
		rows += " GROUP BY " + strings.Join(groupCols, ", ")
	}
	// One extra row tells us whether the result was truncated.
	sql := fmt.Sprintf("%s%s LIMIT %d", rows, sort, limit+1)
	if offset > 0 {
		sql += fmt.Sprintf(" OFFSET %d", offset)
	}
	return &built{sql, values, limit, "SELECT COUNT(*) AS total FROM (" + rows + ") AS we_report_c"}, nil
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
	return &built{fmt.Sprintf("SELECT * FROM (%s) AS we_report_q LIMIT %d", out.String(), maxRows+1), values, maxRows,
		"SELECT COUNT(*) AS total FROM (" + out.String() + ") AS we_report_c"}, nil
}
