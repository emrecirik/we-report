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
    count: "Built | None" = None  # the same rows without order, offset and limit, counted for `total`


OPS = {"=", "!=", "<", "<=", ">", ">=", "like", "contains", "startsWith", "in", "isNull", "notNull"}
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


def like_literal(v: Any) -> str:
    """`contains` / `startsWith` match the text literally: LIKE's wildcards and the escape character are escaped."""
    return re.sub(r"([\\%_])", r"\\\1", "" if v is None else str(v))


def build_select(query: Any, schema: list[dict], quote: Callable[[str], str], placeholder: str, params: dict, max_rows: int,
                 select: Callable[[str, str, str, str, int, int], str]) -> Built:
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

    distinct = query.get("distinct", False)
    if not isinstance(distinct, bool):
        raise ApiError(400, "distinct must be true or false.")
    cols = query.get("columns")
    if distinct and not (isinstance(cols, list) and cols):
        raise ApiError(400, "distinct needs the columns to return.")
    offset = query.get("offset", 0)
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ApiError(400, "offset must be a whole number of 0 or more.")
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
        elif op in ("contains", "startsWith"):
            pattern = f"{'%' if op == 'contains' else ''}{like_literal(value)}%"
            conditions.append(f"LOWER({col}) LIKE LOWER({bind(pattern)}) ESCAPE '\\'")
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
    selected = ("DISTINCT " if distinct else "") + ", ".join(columns)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    # One extra row tells us whether the result was truncated.
    sql = select(selected, quote(table["name"]), where, f" ORDER BY {', '.join(order)}" if order else "", limit + 1, offset)
    count = f"SELECT COUNT(*) AS total FROM (SELECT {selected} FROM {quote(table['name'])}{where}) AS we_report_c"
    return Built(sql, values, limit, Built(count, list(values), 1))


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

    text = _LITERALS_OR_PARAMS.sub(replace, body)
    return Built(wrap(text, max_rows + 1), values, max_rows, Built(f"SELECT COUNT(*) AS total FROM ({text}) AS we_report_c", list(values), 1))
