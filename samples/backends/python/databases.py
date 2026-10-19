"""Database drivers: SQLite (standard library) and PostgreSQL (psycopg, installed on demand)."""
import datetime
import decimal
import os
import re
import sqlite3
from typing import Any

from query import ApiError, Built

_SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "seed.sql")


def type_of(declared: str | None) -> str:
    t = (declared or "").upper()
    if re.search(r"INT|DEC|NUM|REAL|FLOA|DOUB|MONEY", t):
        return "number"
    if re.search(r"DATE|TIME", t):
        return "date"
    if "BOOL" in t:
        return "boolean"
    if re.search(r"CHAR|TEXT|CLOB|UUID", t):
        return "string"
    return "unknown"


def plain(v: Any) -> Any:
    """JSON-friendly values. Dates keep their calendar day (no time-zone shift)."""
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (datetime.date, datetime.datetime, datetime.time)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return None  # shortcut: binary columns are not reportable yet.
    return v


def quote_double(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class Sqlite:
    placeholder = "?"

    def __init__(self, conn: dict):
        self.path = conn["url"]
        if conn.get("seed") == "sample" and not os.path.exists(self.path):
            with open(_SEED, encoding="utf-8") as f, sqlite3.connect(self.path) as db:
                db.executescript(f.read())

    def _open(self) -> sqlite3.Connection:
        # Read-only at the driver level: even an allowed free SQL statement cannot write.
        return sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)

    quote = staticmethod(quote_double)

    @staticmethod
    def select(columns: str, table: str, where: str, order: str, top: int) -> str:
        return f"SELECT {columns} FROM {table}{where}{order} LIMIT {top}"

    @staticmethod
    def wrap(sql: str, top: int) -> str:
        return f"SELECT * FROM ({sql}) AS we_report_q LIMIT {top}"

    def schema(self) -> list[dict]:
        db = self._open()
        try:
            rows = db.execute(
                "SELECT m.name, p.name, p.type FROM sqlite_master m JOIN pragma_table_info(m.name) p "
                "WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid").fetchall()
        finally:
            db.close()
        return _group(rows)

    def query(self, built: Built, timeout_seconds: int) -> list[dict]:
        db = self._open()
        try:
            # shortcut: sqlite3 has no statement timeout; the row limit still applies.
            cur = db.execute(built.sql, built.values)
            names = [d[0] for d in cur.description]
            return [{n: plain(v) for n, v in zip(names, row)} for row in cur.fetchall()]
        finally:
            db.close()


class Postgres:
    placeholder = "%s"
    quote = staticmethod(quote_double)
    select = staticmethod(Sqlite.select)
    wrap = staticmethod(Sqlite.wrap)

    def __init__(self, conn: dict):
        try:
            import psycopg  # noqa: F401
        except ImportError as e:
            raise RuntimeError(f'Connection "{conn["id"]}" is postgres: install the driver with `pip install "psycopg[binary]"`.') from e
        self.url = conn["url"]
        self.schema_name = conn.get("schema") or "public"
        # Without a connect timeout an unreachable database would hang the request.
        self.connect_timeout = max(1, int(conn.get("timeoutSeconds") or 15))

    def _open(self):
        import psycopg
        return psycopg.connect(self.url, autocommit=False, connect_timeout=self.connect_timeout)

    def schema(self) -> list[dict]:
        with self._open() as db:
            rows = db.execute(
                "SELECT table_name, column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = %s ORDER BY table_name, ordinal_position", (self.schema_name,)).fetchall()
        return _group(rows)

    def query(self, built: Built, timeout_seconds: int) -> list[dict]:
        import psycopg
        with self._open() as db:
            try:
                # Read-only transaction with a statement timeout: defence in depth beside the read-only user.
                db.execute("SET TRANSACTION READ ONLY")
                db.execute(f"SET LOCAL statement_timeout = {int(timeout_seconds) * 1000}")
                db.execute(f"SET LOCAL search_path = {quote_double(self.schema_name)}")
                cur = db.execute(built.sql, built.values)
                names = [d.name for d in cur.description]
                return [{n: plain(v) for n, v in zip(names, row)} for row in cur.fetchall()]
            except psycopg.errors.QueryCanceled as e:
                raise ApiError(504, "The query took too long and was stopped.") from e
            finally:
                db.rollback()


def _group(rows) -> list[dict]:
    tables: dict[str, dict] = {}
    for table, column, declared in rows:
        tables.setdefault(table, {"name": table, "columns": []})["columns"].append({"name": column, "type": type_of(declared)})
    return list(tables.values())


DRIVERS = {"sqlite": Sqlite, "postgres": Postgres}
