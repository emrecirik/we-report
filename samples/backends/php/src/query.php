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
    /** @param list<mixed> $values */
    public function __construct(public readonly string $sql, public readonly array $values, public readonly int $limit)
    {
    }
}

const OPS = ['=', '!=', '<', '<=', '>', '>=', 'like', 'in', 'isNull', 'notNull'];
const MAX_IN_VALUES = 1000;
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

    $requested = $query['columns'] ?? null;
    $columns = is_array($requested) && $requested
        ? array_map($column, $requested)
        : array_map(fn ($c) => $quote($c['name']), $table['columns']);

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
            '!=' => "$col <> " . $bind($value),
            default => "$col $op " . $bind($value),
        };
    }

    $order = [];
    foreach ((array) ($query['orderBy'] ?? []) as $o) {
        $dir = is_array($o) ? ($o['dir'] ?? null) : null;
        if (!in_array($dir, [null, 'asc', 'desc'], true)) {
            throw new ApiError(400, 'orderBy.dir must be asc or desc.');
        }
        $order[] = $column($o['column'] ?? null) . ($dir === 'desc' ? ' DESC' : ' ASC');
    }

    $limit = is_int($query['limit'] ?? null) && $query['limit'] > 0 ? min($query['limit'], $maxRows) : $maxRows;
    // One extra row tells us whether the result was truncated.
    $sql = sprintf(
        'SELECT %s FROM %s%s%s LIMIT %d',
        implode(', ', $columns),
        $quote($table['name']),
        $conditions ? ' WHERE ' . implode(' AND ', $conditions) : '',
        $order ? ' ORDER BY ' . implode(', ', $order) : '',
        $limit + 1,
    );
    return new Built($sql, $values, $limit);
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
    return new Built(sprintf('SELECT * FROM (%s) AS we_report_q LIMIT %d', $replaced, $maxRows + 1), $values, $maxRows);
}
