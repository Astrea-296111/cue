#!/usr/bin/env python3
"""Execute only a SQL code block against an authored, isolated SQLite fixture.

Never executes model Python/shell code or opens a real database. SQLite parses
the query; an authorizer, query_only, progress budget and caller timeout bound it.
"""
import json
import re
import sqlite3
import sys

data = json.load(sys.stdin)
blocks = re.findall(r"```(?:sql|sqlite)\s*\n(.*?)```", data["answer"], re.I | re.S)
result = {"passed": False, "kind": "authored SQLite fixture, not original screenshot"}
try:
    if len(blocks) != 1 or len(blocks[0]) > 20000:
        raise ValueError("one complete SQL code block required")
    sql = blocks[0].strip()
    if not re.match(r"^(?:SELECT|WITH)\b", sql, re.I):
        raise ValueError("read-only SELECT required")
    db = sqlite3.connect(":memory:")
    db.executescript(data["fixtureSql"])
    db.execute("PRAGMA query_only=ON")
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}
    functions = {"sum", "count", "avg", "min", "max", "coalesce", "nullif", "round", "cast", "total"}
    def authorize(action, first, second, database, trigger):
        if action not in allowed:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and (second or "").lower() not in functions:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    db.set_authorizer(authorize)
    ticks = 0
    def progress():
        global ticks
        ticks += 1
        return ticks > 100
    db.set_progress_handler(progress, 1000)
    cursor = db.execute(sql)
    columns = [column[0].lower() for column in cursor.description]
    rows = cursor.fetchmany(3)
    aliases = [name.lower() for name in data.get("expectedAliases", [])]
    candidates = [i for i, name in enumerate(columns) if name in aliases]
    # Extra diagnostic aggregates are permitted by the question. Verify the
    # named metric, rather than failing a correct answer with GMV/buyer columns.
    column = 0 if len(columns) == 1 else candidates[0] if len(candidates) == 1 else None
    result.update(sql=sql, columns=columns, rows=rows, checkedColumn=column, expectedScalar=data["expectedScalar"])
    result["passed"] = len(rows) == 1 and column is not None and rows[0][column] is not None and abs(float(rows[0][column])-data["expectedScalar"]) < 1e-8
except Exception as error:
    result["error"] = str(error)
print(json.dumps(result, ensure_ascii=False))
