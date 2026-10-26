# CUE public latest evaluation

{
  "qwen": {
    "samples": 19,
    "passed": 16,
    "lengthPassed": 19,
    "semanticPassed": 18,
    "sourceFailures": 2,
    "preparationMs": {
      "count": 18,
      "p50": 19.05,
      "p95": 111.88,
      "max": 111.88
    },
    "firstSentenceMs": {
      "count": 18,
      "p50": 2085.79,
      "p95": 4577.58,
      "max": 4577.58
    },
    "doneMs": {
      "count": 19,
      "p50": 3195.06,
      "p95": 6588.77,
      "max": 6588.77
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 19,
    "passed": 12,
    "lengthPassed": 18,
    "semanticPassed": 18,
    "sourceFailures": 0,
    "preparationMs": {
      "count": 18,
      "p50": 17.61,
      "p95": 38.97,
      "max": 38.97
    },
    "firstSentenceMs": {
      "count": 18,
      "p50": 1296.36,
      "p95": 2225.61,
      "max": 2225.61
    },
    "doneMs": {
      "count": 19,
      "p50": 2034.18,
      "p95": 3256.1,
      "max": 3256.1
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/latest-02 repeat 1](qwen/latest-02-r1/answer.txt): passed
- [qwen/latest-01 repeat 1](qwen/latest-01-r1/answer.txt): passed
- [qwen/latest-03 repeat 1](qwen/latest-03-r1/answer.txt): passed
- [qwen/latest-04 repeat 1](qwen/latest-04-r1/answer.txt): passed
- [qwen/latest-05 repeat 1](qwen/latest-05-r1/answer.txt): needs review
- [qwen/latest-07 repeat 1](qwen/latest-07-r1/answer.txt): passed
- [qwen/latest-06 repeat 1](qwen/latest-06-r1/answer.txt): passed
- [qwen/latest-08 repeat 1](qwen/latest-08-r1/answer.txt): passed
- [qwen/latest-09 repeat 1](qwen/latest-09-r1/answer.txt): passed
- [qwen/latest-10 repeat 1](qwen/latest-10-r1/answer.txt): needs review
- [qwen/latest-11 repeat 1](qwen/latest-11-r1/answer.txt): passed
- [qwen/latest-12 repeat 1](qwen/latest-12-r1/answer.txt): passed
- [qwen/latest-13 repeat 1](qwen/latest-13-r1/answer.txt): passed
- [qwen/latest-14 repeat 1](qwen/latest-14-r1/answer.txt): passed
- [qwen/latest-15 repeat 1](qwen/latest-15-r1/answer.txt): passed
- [qwen/latest-16 repeat 1](qwen/latest-16-r1/answer.txt): passed
- [qwen/latest-17 repeat 1](qwen/latest-17-r1/answer.txt): needs review
- [qwen/latest-sql-01 repeat 1](qwen/latest-sql-01-r1/answer.txt): passed
- [qwen/latest-sql-02 repeat 1](qwen/latest-sql-02-r1/answer.txt): passed
- [deepseek/latest-02 repeat 1](deepseek/latest-02-r1/answer.txt): passed
- [deepseek/latest-01 repeat 1](deepseek/latest-01-r1/answer.txt): passed
- [deepseek/latest-03 repeat 1](deepseek/latest-03-r1/answer.txt): passed
- [deepseek/latest-04 repeat 1](deepseek/latest-04-r1/answer.txt): passed
- [deepseek/latest-05 repeat 1](deepseek/latest-05-r1/answer.txt): needs review
- [deepseek/latest-06 repeat 1](deepseek/latest-06-r1/answer.txt): passed
- [deepseek/latest-07 repeat 1](deepseek/latest-07-r1/answer.txt): needs review
- [deepseek/latest-08 repeat 1](deepseek/latest-08-r1/answer.txt): needs review
- [deepseek/latest-09 repeat 1](deepseek/latest-09-r1/answer.txt): needs review
- [deepseek/latest-10 repeat 1](deepseek/latest-10-r1/answer.txt): passed
- [deepseek/latest-11 repeat 1](deepseek/latest-11-r1/answer.txt): needs review
- [deepseek/latest-12 repeat 1](deepseek/latest-12-r1/answer.txt): passed
- [deepseek/latest-13 repeat 1](deepseek/latest-13-r1/answer.txt): passed
- [deepseek/latest-14 repeat 1](deepseek/latest-14-r1/answer.txt): passed
- [deepseek/latest-15 repeat 1](deepseek/latest-15-r1/answer.txt): passed
- [deepseek/latest-16 repeat 1](deepseek/latest-16-r1/answer.txt): passed
- [deepseek/latest-sql-01 repeat 1](deepseek/latest-sql-01-r1/answer.txt): needs review
- [deepseek/latest-17 repeat 1](deepseek/latest-17-r1/answer.txt): needs review
- [deepseek/latest-sql-02 repeat 1](deepseek/latest-sql-02-r1/answer.txt): passed