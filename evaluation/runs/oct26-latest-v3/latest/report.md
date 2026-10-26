# CUE public latest evaluation

{
  "qwen": {
    "samples": 19,
    "passed": 15,
    "lengthPassed": 19,
    "semanticPassed": 19,
    "sourceFailures": 1,
    "preparationMs": {
      "count": 19,
      "p50": 19.91,
      "p95": 112.46,
      "max": 112.46
    },
    "firstSentenceMs": {
      "count": 19,
      "p50": 3096.06,
      "p95": 5093.09,
      "max": 5093.09
    },
    "doneMs": {
      "count": 19,
      "p50": 3701.94,
      "p95": 5184.1,
      "max": 5184.1
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 19,
    "passed": 18,
    "lengthPassed": 19,
    "semanticPassed": 19,
    "sourceFailures": 0,
    "preparationMs": {
      "count": 19,
      "p50": 19.3,
      "p95": 46.97,
      "max": 46.97
    },
    "firstSentenceMs": {
      "count": 19,
      "p50": 1274.25,
      "p95": 2124.13,
      "max": 2124.13
    },
    "doneMs": {
      "count": 19,
      "p50": 1907.2,
      "p95": 2884.41,
      "max": 2884.41
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/latest-02 repeat 1](qwen/latest-02-r1/answer.txt): passed
- [qwen/latest-01 repeat 1](qwen/latest-01-r1/answer.txt): needs review
- [qwen/latest-03 repeat 1](qwen/latest-03-r1/answer.txt): passed
- [qwen/latest-04 repeat 1](qwen/latest-04-r1/answer.txt): passed
- [qwen/latest-05 repeat 1](qwen/latest-05-r1/answer.txt): passed
- [qwen/latest-06 repeat 1](qwen/latest-06-r1/answer.txt): passed
- [qwen/latest-07 repeat 1](qwen/latest-07-r1/answer.txt): passed
- [qwen/latest-08 repeat 1](qwen/latest-08-r1/answer.txt): passed
- [qwen/latest-09 repeat 1](qwen/latest-09-r1/answer.txt): passed
- [qwen/latest-10 repeat 1](qwen/latest-10-r1/answer.txt): needs review
- [qwen/latest-11 repeat 1](qwen/latest-11-r1/answer.txt): passed
- [qwen/latest-12 repeat 1](qwen/latest-12-r1/answer.txt): passed
- [qwen/latest-13 repeat 1](qwen/latest-13-r1/answer.txt): passed
- [qwen/latest-14 repeat 1](qwen/latest-14-r1/answer.txt): needs review
- [qwen/latest-15 repeat 1](qwen/latest-15-r1/answer.txt): passed
- [qwen/latest-16 repeat 1](qwen/latest-16-r1/answer.txt): passed
- [qwen/latest-17 repeat 1](qwen/latest-17-r1/answer.txt): needs review
- [qwen/latest-sql-01 repeat 1](qwen/latest-sql-01-r1/answer.txt): passed
- [qwen/latest-sql-02 repeat 1](qwen/latest-sql-02-r1/answer.txt): passed
- [deepseek/latest-02 repeat 1](deepseek/latest-02-r1/answer.txt): passed
- [deepseek/latest-01 repeat 1](deepseek/latest-01-r1/answer.txt): passed
- [deepseek/latest-03 repeat 1](deepseek/latest-03-r1/answer.txt): passed
- [deepseek/latest-04 repeat 1](deepseek/latest-04-r1/answer.txt): passed
- [deepseek/latest-05 repeat 1](deepseek/latest-05-r1/answer.txt): passed
- [deepseek/latest-06 repeat 1](deepseek/latest-06-r1/answer.txt): passed
- [deepseek/latest-07 repeat 1](deepseek/latest-07-r1/answer.txt): passed
- [deepseek/latest-08 repeat 1](deepseek/latest-08-r1/answer.txt): passed
- [deepseek/latest-10 repeat 1](deepseek/latest-10-r1/answer.txt): passed
- [deepseek/latest-09 repeat 1](deepseek/latest-09-r1/answer.txt): passed
- [deepseek/latest-11 repeat 1](deepseek/latest-11-r1/answer.txt): passed
- [deepseek/latest-12 repeat 1](deepseek/latest-12-r1/answer.txt): passed
- [deepseek/latest-13 repeat 1](deepseek/latest-13-r1/answer.txt): passed
- [deepseek/latest-14 repeat 1](deepseek/latest-14-r1/answer.txt): passed
- [deepseek/latest-15 repeat 1](deepseek/latest-15-r1/answer.txt): passed
- [deepseek/latest-16 repeat 1](deepseek/latest-16-r1/answer.txt): passed
- [deepseek/latest-sql-01 repeat 1](deepseek/latest-sql-01-r1/answer.txt): passed
- [deepseek/latest-17 repeat 1](deepseek/latest-17-r1/answer.txt): needs review
- [deepseek/latest-sql-02 repeat 1](deepseek/latest-sql-02-r1/answer.txt): passed