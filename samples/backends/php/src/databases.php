<?php
// Database drivers over PDO: SQLite (pdo_sqlite) and PostgreSQL (pdo_pgsql).

declare(strict_types=1);

function type_of(?string $declared): string
{
    $t = strtoupper($declared ?? '');
    return match (true) {
        (bool) preg_match('/INT|DEC|NUM|REAL|FLOA|DOUB|MONEY/', $t) => 'number',
        (bool) preg_match('/DATE|TIME/', $t) => 'date',
        str_contains($t, 'BOOL') => 'boolean',
        (bool) preg_match('/CHAR|TEXT|CLOB|UUID/', $t) => 'string',
        default => 'unknown',
    };
}

function quote_double(string $name): string
{
    return '"' . str_replace('"', '""', $name) . '"';
}

/** @param list<array{0: string, 1: string, 2: ?string}> $rows */
function group_columns(array $rows): array
{
    $tables = [];
    foreach ($rows as [$table, $column, $declared]) {
        $tables[$table] ??= ['name' => $table, 'columns' => []];
        $tables[$table]['columns'][] = ['name' => $column, 'type' => type_of($declared)];
    }
    return array_values($tables);
}

/** JSON-friendly rows: numbers stay numbers (PDO returns NUMERIC as text), binary is dropped. */
function plain_rows(PDOStatement $statement): array
{
    $numeric = [];
    for ($i = 0; $i < $statement->columnCount(); $i++) {
        $meta = $statement->getColumnMeta($i) ?: [];
        $numeric[$meta['name'] ?? $i] = (bool) preg_match('/numeric|decimal|money/i', (string) ($meta['native_type'] ?? ''));
    }
    $rows = [];
    while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
        foreach ($row as $name => $value) {
            if (is_string($value) && ($numeric[$name] ?? false) && is_numeric($value)) {
                $row[$name] = (float) $value;
            } elseif (is_resource($value)) {
                $row[$name] = null; // shortcut: binary columns are not reportable yet.
            }
        }
        $rows[] = $row;
    }
    return $rows;
}

function bind_all(PDOStatement $statement, array $values): void
{
    foreach ($values as $i => $v) {
        $statement->bindValue($i + 1, $v, match (true) {
            $v === null => PDO::PARAM_NULL,
            is_int($v) => PDO::PARAM_INT,
            default => PDO::PARAM_STR,
        });
    }
}

interface Database
{
    public function schema(): array;
    public function query(Built $built, int $timeoutSeconds): array;
}

final class SqliteDatabase implements Database
{
    private string $path;

    public function __construct(array $conn)
    {
        $this->path = $conn['url'];
        if (($conn['seed'] ?? null) === 'sample' && !file_exists($this->path)) {
            $seed = getenv('WE_REPORT_SEED') ?: dirname(__DIR__, 3) . '/data/seed.sql';
            $db = new PDO('sqlite:' . $this->path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $db->exec((string) file_get_contents($seed));
        }
    }

    private function open(): PDO
    {
        // Read-only at the driver level: even an allowed free SQL statement cannot write.
        return new PDO('sqlite:' . $this->path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY,
        ]);
    }

    public function schema(): array
    {
        $rows = $this->open()->query(
            "SELECT m.name, p.name, p.type FROM sqlite_master m JOIN pragma_table_info(m.name) p
             WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid"
        )->fetchAll(PDO::FETCH_NUM);
        return group_columns($rows);
    }

    public function query(Built $built, int $timeoutSeconds): array
    {
        $db = $this->open();
        // Busy timeout; SQLite has no statement timeout, the row limit still applies.
        $db->setAttribute(PDO::ATTR_TIMEOUT, $timeoutSeconds);
        $statement = $db->prepare($built->sql);
        bind_all($statement, $built->values);
        $statement->execute();
        return plain_rows($statement);
    }
}

final class PostgresDatabase implements Database
{
    private string $dsn;
    private ?string $user;
    private ?string $password;
    private string $schemaName;

    public function __construct(array $conn)
    {
        if (!extension_loaded('pdo_pgsql')) {
            throw new RuntimeException(sprintf('Connection "%s" is postgres: enable the pdo_pgsql extension.', $conn['id']));
        }
        // postgresql://user:password@host:port/db → a PDO DSN; credentials never leave this object.
        $u = parse_url($conn['url']);
        if (!$u || !isset($u['host'])) {
            throw new RuntimeException(sprintf('Connection "%s" needs a postgresql:// url.', $conn['id']));
        }
        // Without a connect timeout an unreachable database would hang the request.
        $this->dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;connect_timeout=%d', $u['host'], $u['port'] ?? 5432, ltrim($u['path'] ?? '', '/'), max(1, intdiv($conn['timeoutMs'], 1000)));
        $this->user = isset($u['user']) ? urldecode($u['user']) : null;
        $this->password = isset($u['pass']) ? urldecode($u['pass']) : null;
        $this->schemaName = $conn['schema'] ?? 'public';
    }

    private function open(): PDO
    {
        return new PDO($this->dsn, $this->user, $this->password, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
    }

    public function schema(): array
    {
        $statement = $this->open()->prepare(
            'SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = ? ORDER BY table_name, ordinal_position'
        );
        $statement->execute([$this->schemaName]);
        return group_columns($statement->fetchAll(PDO::FETCH_NUM));
    }

    public function query(Built $built, int $timeoutSeconds): array
    {
        $db = $this->open();
        // Read-only transaction with a statement timeout, always rolled back: defence in depth
        // beside the read-only database user.
        $db->exec('BEGIN READ ONLY');
        try {
            $db->exec(sprintf('SET LOCAL statement_timeout = %d', $timeoutSeconds * 1000));
            $db->exec('SET LOCAL search_path = ' . quote_double($this->schemaName));
            $statement = $db->prepare($built->sql);
            bind_all($statement, $built->values);
            $statement->execute();
            return plain_rows($statement);
        } catch (PDOException $e) {
            if ($e->getCode() === '57014') {
                throw new ApiError(504, 'The query took too long and was stopped.');
            }
            throw $e;
        } finally {
            $db->exec('ROLLBACK');
        }
    }
}

function open_database(array $conn): Database
{
    return $conn['dialect'] === 'postgres' ? new PostgresDatabase($conn) : new SqliteDatabase($conn);
}
