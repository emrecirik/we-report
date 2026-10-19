"""Turns the protocol's structured query into SQL.

Every identifier is checked against the introspected schema and quoted by the dialect; every
value is a DB-API parameter.
"""
import re
from dataclasses import dataclass
from typing import Any, Callable


class ApiError(Exception):
    """An error whose message is safe to show to the caller."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Built:
    sql: str
    values: list
    limit: int


OPS = {"=", "!=", "<", "<=", ">", ">=", "like", "in", "isNull", "notNull"}
MAX_IN_VALUES = 1000
# Standard strings, quoted and [bracketed] identifiers, comments — matched left to right.
_LITERALS = r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|\[[^\]]*\]|--[^\n]*|/\*[\s\S]*?\*/"
_LITERALS_RE = re.compile(_LITERALS)
_LITERALS_OR_PARAMS = re.compile(_LITERALS + r"|(?<![:\w]):([A-Za-z_]\w*)")


def driver_value(v: Any) -> Any:
    """JSON values from the request: drivers only ever see text, numbers and None."""
    if v is None or isinstance(v, (str, int, float)) and not isinstance(v, bool):
        return v
    if isinstance(v, bool):
        return 1 if v else 0
    raise ApiError(400, "Query values must be text, numbers, booleans or null.")


def build_select(query: Any, schema: list[dict], quote: Callable[[str], str], placeholder: str, params: dict, max_rows: int,
                 select: Callable[[str, str, str, str, int], str]) -> Built:
    if not isinstance(query, dict):
        raise ApiError(400, "query must be an object.")
    table = next((t for t in schema if t["name"] == query.get("table")), None)
    if table is None:
        raise ApiError(400, f'Unknown table "{query.get("table")}".')
    known = {c["name"] for c in table["columns"]}

    def column(name: Any) -> str:
        if not isinstance(name, str) or name not in known:
            raise ApiError(400, f'Unknown column "{name}" in "{table["name"]}".')
        return quote(name)

    values: list = []

    def bind(v: Any) -> str:
        values.append(driver_value(v))
        return placeholder

    cols = query.get("columns")
    columns = [column(c) for c in cols] if isinstance(cols, list) and cols else [quote(c["name"]) for c in table["columns"]]

    conditions = []
    for w in query.get("where") or []:
        op = w.get("op") if isinstance(w, dict) else None
        if op not in OPS:
            raise ApiError(400, f'Unsupported operator "{op}".')
        col = column(w.get("column"))
        value = params.get(w["param"]) if isinstance(w.get("param"), str) else w.get("value")
        if op == "isNull":
            conditions.append(f"{col} IS NULL")
        elif op == "notNull":
            conditions.append(f"{col} IS NOT NULL")
        elif op == "in":
            if not isinstance(value, list) or not 0 < len(value) <= MAX_IN_VALUES:
                raise ApiError(400, f'"in" needs a list of 1-{MAX_IN_VALUES} values.')
            conditions.append(f"{col} IN ({', '.join(bind(v) for v in value)})")
        elif op == "like":
            conditions.append(f"{col} LIKE {bind(value)}")
        else:
            conditions.append(f"{col} {'<>' if op == '!=' else op} {bind(value)}")

    order = []
    for o in query.get("orderBy") or []:
        d = o.get("dir") if isinstance(o, dict) else None
        if d not in (None, "asc", "desc"):
            raise ApiError(400, "orderBy.dir must be asc or desc.")
        order.append(f"{column(o.get('column'))} {'DESC' if d == 'desc' else 'ASC'}")

    requested = query.get("limit") if isinstance(query.get("limit"), int) and query["limit"] > 0 else max_rows
    limit = min(requested, max_rows)
    # One extra row tells us whether the result was truncated.
    sql = select(", ".join(columns), quote(table["name"]),
                 f" WHERE {' AND '.join(conditions)}" if conditions else "",
                 f" ORDER BY {', '.join(order)}" if order else "",
                 limit + 1)
    return Built(sql, values, limit)


def build_free_sql(sql: Any, placeholder: str, params: dict, max_rows: int, wrap: Callable[[str, int], str]) -> Built:
    """Free SQL (only where allowed): one SELECT statement, :name parameters, row limit."""
    if not isinstance(sql, str) or not sql.strip():
        raise ApiError(400, "sql must be a non-empty string.")
    body = re.sub(r";\s*$", "", sql.strip())
    # Backslash escapes (Postgres E'..') and dollar quoting change where a string ends in ways the
    # stripper cannot follow, which could hide a second statement. Report SQL never needs them.
    if re.search(r"\\|\$[A-Za-z_]*\$", body):
        raise ApiError(400, "Free SQL cannot contain backslashes or dollar-quoted strings.")
    bare = _LITERALS_RE.sub("''", body)
    if ";" in bare:
        raise ApiError(400, "Only one SQL statement is allowed.")
    if not re.match(r"^\s*(select|with)\b", bare, re.IGNORECASE):
        raise ApiError(400, "Only SELECT queries are allowed.")
    values: list = []

    # Literals and comments are matched first and kept, so only real :name parameters are replaced.
    def replace(m: re.Match) -> str:
        if m.group(1) is None:
            return m.group(0)
        values.append(driver_value(params.get(m.group(1))))
        return placeholder

    return Built(wrap(_LITERALS_OR_PARAMS.sub(replace, body), max_rows + 1), values, max_rows)
