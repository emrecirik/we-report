<?php
// Turns the protocol's structured query into SQL. Every identifier is checked against the
// introspected schema and quoted by the dialect; every value is a bound PDO parameter.

declare(strict_types=1);

/** An error whose message is safe to show to the caller. */
final class ApiError extends Exception
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Built
{
    /** @param list<mixed> $values  $count: the same rows without order/offset/limit, counted for `total` */
    public function __construct(public readonly string $sql, public readonly array $values, public readonly int $limit, public readonly ?Built $count = null)
    {
    }
}

const OPS = ['=', '!=', '<', '<=', '>', '>=', 'like', 'contains', 'startsWith', 'in', 'isNull', 'notNull'];
const MAX_IN_VALUES = 1000;
const AGGREGATES = ['sum', 'avg', 'min', 'max', 'count'];
const MAX_SEARCH_WORDS = 10;
// Standard strings, quoted and [bracketed] identifiers, comments — matched left to right.
const LITERALS = "'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|\\[[^\\]]*\\]|--[^\\n]*|/\\*[\\s\\S]*?\\*/";

/** JSON values from the request: drivers only ever see text, numbers and null. */
function driver_value(mixed $v): mixed
{
    if ($v === null || is_string($v) || is_int($v) || is_float($v)) {
        return $v;
    }
    if (is_bool($v)) {
        return $v ? 1 : 0;
    }
    throw new ApiError(400, 'Query values must be text, numbers, booleans or null.');
}

/**
 * @param array<string, mixed> $params
 * @param list<array{name: string, columns: list<array{name: string, type: string}>}> $schema
 */
function build_select(mixed $query, array $schema, callable $quote, array $params, int $maxRows): Built
{
    if (!is_array($query)) {
        throw new ApiError(400, 'query must be an object.');
    }
    $table = null;
    foreach ($schema as $t) {
        if ($t['name'] === ($query['table'] ?? null)) {
            $table = $t;
        }
    }
    if ($table === null) {
        throw new ApiError(400, sprintf('Unknown table "%s".', is_scalar($query['table'] ?? null) ? $query['table'] : ''));
    }
    $known = array_column($table['columns'], 'name');
    $column = function (mixed $name) use ($known, $quote, $table): string {
        if (!is_string($name) || !in_array($name, $known, true)) {
            throw new ApiError(400, sprintf('Unknown column "%s" in "%s".', is_scalar($name) ? $name : '', $table['name']));
        }
        return $quote($name);
    };
    $values = [];
    $bind = function (mixed $v) use (&$values): string {
        $values[] = driver_value($v);
        return '?';
    };

    $distinct = $query['distinct'] ?? false;
    if (!is_bool($distinct)) {
        throw new ApiError(400, 'distinct must be true or false.');
    }
    $requested = $query['columns'] ?? null;
    if ($distinct && !(is_array($requested) && $requested)) {
        throw new ApiError(400, 'distinct needs the columns to return.');
    }
    $offset = $query['offset'] ?? 0;
    if (!is_int($offset) || $offset < 0) {
        throw new ApiError(400, 'offset must be a whole number of 0 or more.');
    }

    // 1.2 groups: one row per combination of the groupBy columns, with its count and subtotals
    $grouped = array_key_exists('groupBy', $query);
    $groupCols = [];
    if ($grouped) {
        $groupBy = $query['groupBy'];
        if (!is_array($groupBy) || !array_is_list($groupBy) || count($groupBy) < 1 || count($groupBy) > 8
            || count(array_unique(array_map(fn ($g) => is_string($g) ? $g : '', $groupBy))) !== count($groupBy)) {
            throw new ApiError(400, 'groupBy must list 1-8 different columns.');
        }
        if ((is_array($requested) && $requested) || $distinct || $offset) {
            throw new ApiError(400, 'groupBy does not go with columns, distinct or offset.');
        }
        $groupCols = array_map($column, $groupBy);
    }
    $aggregateCols = [];
    if (array_key_exists('aggregates', $query)) {
        if (!$grouped) {
            throw new ApiError(400, 'aggregates need groupBy.');
        }
        if (!is_array($query['aggregates']) || !array_is_list($query['aggregates']) || count($query['aggregates']) > 32) {
            throw new ApiError(400, 'aggregates must be a list of at most 32.');
        }
        $aliases = [];
        foreach ($query['aggregates'] as $a) {
            $fn = is_array($a) ? ($a['fn'] ?? null) : null;
            if (!in_array($fn, AGGREGATES, true)) {
                throw new ApiError(400, sprintf('Unsupported aggregate "%s".', is_scalar($fn) ? $fn : ''));
            }
            $alias = $a['as'] ?? null;
            if (!is_string($alias) || !preg_match('/^(?!__)[A-Za-z_][A-Za-z0-9_]{0,63}$/', $alias)) {
                throw new ApiError(400, sprintf('Aggregate name "%s" must be a plain identifier not starting with __.', is_scalar($alias) ? $alias : ''));
            }
            if (in_array($alias, $aliases, true)) {
                throw new ApiError(400, 'Aggregate names must be different.');
            }
            $aliases[] = $alias;
            $aggregateCols[] = strtoupper($fn) . '(' . $column($a['column'] ?? null) . ') AS ' . $quote($alias);
        }
    }
    $columns = $grouped
        ? [...$groupCols, 'COUNT(*) AS ' . $quote('__count'), ...$aggregateCols]
        : (is_array($requested) && $requested
            ? array_map($column, $requested)
            : array_map(fn ($c) => $quote($c['name']), $table['columns']));

    $conditions = [];
    foreach ((array) ($query['where'] ?? []) as $w) {
        $op = is_array($w) ? ($w['op'] ?? null) : null;
        if (!in_array($op, OPS, true)) {
            throw new ApiError(400, sprintf('Unsupported operator "%s".', is_scalar($op) ? $op : ''));
        }
        $col = $column($w['column'] ?? null);
        $value = is_string($w['param'] ?? null) ? ($params[$w['param']] ?? null) : ($w['value'] ?? null);
        $conditions[] = match ($op) {
            'isNull' => "$col IS NULL",
            'notNull' => "$col IS NOT NULL",
            'in' => is_array($value) && array_is_list($value) && count($value) > 0 && count($value) <= MAX_IN_VALUES
                ? "$col IN (" . implode(', ', array_map($bind, $value)) . ')'
                : throw new ApiError(400, sprintf('"in" needs a list of 1-%d values.', MAX_IN_VALUES)),
            'like' => "$col LIKE " . $bind($value),
            // Literal and case-insensitive: LIKE's wildcards and the escape character are escaped.
            // The escape character is a parameter: PDO's PostgreSQL parser would read a '\' literal as
            // unfinished and lose every placeholder after it.
            'contains', 'startsWith' => "LOWER($col) LIKE LOWER("
                . $bind(($op === 'contains' ? '%' : '') . addcslashes((string) driver_value($value), '\\%_') . '%')
                . ') ESCAPE ' . $bind('\\'),
            '!=' => "$col <> " . $bind($value),
            default => "$col $op " . $bind($value),
        };
    }

    // 1.2 search: every word in some column, read as text — AND across words, OR across columns
    if (array_key_exists('search', $query)) {
        $search = $query['search'];
        $text = is_array($search) ? ($search['text'] ?? null) : null;
        $searchCols = is_array($search) ? ($search['columns'] ?? null) : null;
        if (!is_string($text) || mb_strlen($text) > 200 || !is_array($searchCols) || !array_is_list($searchCols) || count($searchCols) < 1 || count($searchCols) > 50) {
            throw new ApiError(400, 'search needs text (at most 200 characters) and 1-50 columns.');
        }
        $searched = array_map($column, $searchCols);
        $words = array_slice(preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: [], 0, MAX_SEARCH_WORDS);
        foreach ($words as $word) {
            $pattern = '%' . addcslashes($word, '\\%_') . '%';
            $conditions[] = '(' . implode(' OR ', array_map(
                fn ($col) => "LOWER(CAST($col AS TEXT)) LIKE LOWER(" . $bind($pattern) . ') ESCAPE ' . $bind('\\'),
                $searched,
            )) . ')';
        }
    }

    // Groups come in groupBy order, NULL first, unless the caller orders them
    $orderBy = $query['orderBy'] ?? ($grouped ? array_map(fn ($g) => ['column' => $g, 'nulls' => 'first'], $query['groupBy']) : []);
    $order = [];
    foreach ((array) $orderBy as $o) {
        $dir = is_array($o) ? ($o['dir'] ?? null) : null;
        if (!in_array($dir, [null, 'asc', 'desc'], true)) {
            throw new ApiError(400, 'orderBy.dir must be asc or desc.');
        }
        $nulls = is_array($o) ? ($o['nulls'] ?? null) : null;
        if (!in_array($nulls, [null, 'first', 'last'], true)) {
            throw new ApiError(400, 'orderBy.nulls must be first or last.');
        }
        $col = $column($o['column'] ?? null);
        $by = $col . ($dir === 'desc' ? ' DESC' : ' ASC');
        // CASE rather than NULLS FIRST/LAST: every dialect has it (MySQL and SQL Server have no NULLS clause)
        $order[] = $nulls === null ? $by : sprintf('CASE WHEN %s IS NULL THEN %d ELSE %d END, %s', $col, $nulls === 'first' ? 0 : 1, $nulls === 'first' ? 1 : 0, $by);
    }

    $limit = is_int($query['limit'] ?? null) && $query['limit'] > 0 ? min($query['limit'], $maxRows) : $maxRows;
    $select = sprintf(
        'SELECT %s%s FROM %s%s%s',
        $distinct ? 'DISTINCT ' : '',
        implode(', ', $columns),
        $quote($table['name']),
        $conditions ? ' WHERE ' . implode(' AND ', $conditions) : '',
        $grouped ? ' GROUP BY ' . implode(', ', $groupCols) : '',
    );
    // One extra row tells us whether the result was truncated.
    $sql = sprintf('%s%s LIMIT %d%s', $select, $order ? ' ORDER BY ' . implode(', ', $order) : '', $limit + 1, $offset ? " OFFSET $offset" : '');
    return new Built($sql, $values, $limit, new Built("SELECT COUNT(*) AS total FROM ($select) AS we_report_c", $values, 1));
}

/**
 * Free SQL (only where allowed): one SELECT statement, :name parameters, row limit.
 * @param array<string, mixed> $params
 */
function build_free_sql(mixed $sql, array $params, int $maxRows): Built
{
    if (!is_string($sql) || trim($sql) === '') {
        throw new ApiError(400, 'sql must be a non-empty string.');
    }
    $body = preg_replace('/;\s*$/', '', trim($sql));
    // Backslash escapes (Postgres E'..') and dollar quoting change where a string ends in ways the
    // stripper cannot follow, which could hide a second statement. Report SQL never needs them.
    if (preg_match('/\\\\|\$[A-Za-z_]*\$/', $body)) {
        throw new ApiError(400, 'Free SQL cannot contain backslashes or dollar-quoted strings.');
    }
    $bare = preg_replace('~' . LITERALS . '~', "''", $body);
    if (str_contains($bare, ';')) {
        throw new ApiError(400, 'Only one SQL statement is allowed.');
    }
    if (!preg_match('/^\s*(select|with)\b/i', $bare)) {
        throw new ApiError(400, 'Only SELECT queries are allowed.');
    }
    $values = [];
    // Literals and comments are matched first and kept, so only real :name parameters are replaced.
    $replaced = preg_replace_callback('~' . LITERALS . '|(?<![:\w]):([A-Za-z_]\w*)~', function (array $m) use (&$values, $params): string {
        if (!isset($m[1]) || $m[1] === '') {
            return $m[0];
        }
        $values[] = driver_value($params[$m[1]] ?? null);
        return '?';
    }, $body);
    return new Built(sprintf('SELECT * FROM (%s) AS we_report_q LIMIT %d', $replaced, $maxRows + 1), $values, $maxRows,
        new Built("SELECT COUNT(*) AS total FROM ($replaced) AS we_report_c", $values, 1));
}
