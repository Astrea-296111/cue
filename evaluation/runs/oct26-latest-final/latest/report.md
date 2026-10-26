# CUE public latest evaluation

{
  "qwen": {
    "samples": 19,
    "passed": 14,
    "lengthPassed": 19,
    "semanticPassed": 19,
    "sourceFailures": 3,
    "preparationMs": {
      "count": 19,
      "p50": 14.57,
      "p95": 70.58,
      "max": 70.58
    },
    "firstSentenceMs": {
      "count": 19,
      "p50": 1490.89,
      "p95": 3077.2,
      "max": 3077.2
    },
    "doneMs": {
      "count": 19,
      "p50": 2607.85,
      "p95": 4755.52,
      "max": 4755.52
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 19,
    "passed": 13,
    "lengthPassed": 19,
    "semanticPassed": 18,
    "sourceFailures": 4,
    "preparationMs": {
      "count": 19,
      "p50": 14.86,
      "p95": 31.99,
      "max": 31.99
    },
    "firstSentenceMs": {
      "count": 19,
      "p50": 1380.05,
      "p95": 2020.29,
      "max": 2020.29
    },
    "doneMs": {
      "count": 19,
      "p50": 1844.25,
      "p95": 2786.21,
      "max": 2786.21
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/latest-01 repeat 1](qwen/latest-01-r1/answer.txt): passed
- [qwen/latest-02 repeat 1](qwen/latest-02-r1/answer.txt): passed
- [qwen/latest-03 repeat 1](qwen/latest-03-r1/answer.txt): passed
- [qwen/latest-04 repeat 1](qwen/latest-04-r1/answer.txt): passed
- [qwen/latest-05 repeat 1](qwen/latest-05-r1/answer.txt): passed
- [qwen/latest-06 repeat 1](qwen/latest-06-r1/answer.txt): needs review
- [qwen/latest-07 repeat 1](qwen/latest-07-r1/answer.txt): passed
- [qwen/latest-08 repeat 1](qwen/latest-08-r1/answer.txt): passed
- [qwen/latest-09 repeat 1](qwen/latest-09-r1/answer.txt): passed
- [qwen/latest-10 repeat 1](qwen/latest-10-r1/answer.txt): needs review
- [qwen/latest-11 repeat 1](qwen/latest-11-r1/answer.txt): passed
- [qwen/latest-12 repeat 1](qwen/latest-12-r1/answer.txt): passed
- [qwen/latest-13 repeat 1](qwen/latest-13-r1/answer.txt): passed
- [qwen/latest-14 repeat 1](qwen/latest-14-r1/answer.txt): passed
- [qwen/latest-15 repeat 1](qwen/latest-15-r1/answer.txt): passed
- [qwen/latest-16 repeat 1](qwen/latest-16-r1/answer.txt): needs review
- [qwen/latest-17 repeat 1](qwen/latest-17-r1/answer.txt): needs review
- [qwen/latest-sql-01 repeat 1](qwen/latest-sql-01-r1/answer.txt): passed
- [qwen/latest-sql-02 repeat 1](qwen/latest-sql-02-r1/answer.txt): needs review
- [deepseek/latest-02 repeat 1](deepseek/latest-02-r1/answer.txt): needs review
- [deepseek/latest-01 repeat 1](deepseek/latest-01-r1/answer.txt): passed
- [deepseek/latest-03 repeat 1](deepseek/latest-03-r1/answer.txt): passed
- [deepseek/latest-04 repeat 1](deepseek/latest-04-r1/answer.txt): passed
- [deepseek/latest-05 repeat 1](deepseek/latest-05-r1/answer.txt): passed
- [deepseek/latest-06 repeat 1](deepseek/latest-06-r1/answer.txt): passed
- [deepseek/latest-07 repeat 1](deepseek/latest-07-r1/answer.txt): passed
- [deepseek/latest-08 repeat 1](deepseek/latest-08-r1/answer.txt): needs review
- [deepseek/latest-09 repeat 1](deepseek/latest-09-r1/answer.txt): passed
- [deepseek/latest-10 repeat 1](deepseek/latest-10-r1/answer.txt): passed
- [deepseek/latest-12 repeat 1](deepseek/latest-12-r1/answer.txt): passed
- [deepseek/latest-11 repeat 1](deepseek/latest-11-r1/answer.txt): passed
- [deepseek/latest-14 repeat 1](deepseek/latest-14-r1/answer.txt): passed
- [deepseek/latest-13 repeat 1](deepseek/latest-13-r1/answer.txt): passed
- [deepseek/latest-16 repeat 1](deepseek/latest-16-r1/answer.txt): needs review
- [deepseek/latest-15 repeat 1](deepseek/latest-15-r1/answer.txt): needs review
- [deepseek/latest-sql-01 repeat 1](deepseek/latest-sql-01-r1/answer.txt): needs review
- [deepseek/latest-17 repeat 1](deepseek/latest-17-r1/answer.txt): needs review
- [deepseek/latest-sql-02 repeat 1](deepseek/latest-sql-02-r1/answer.txt): passed