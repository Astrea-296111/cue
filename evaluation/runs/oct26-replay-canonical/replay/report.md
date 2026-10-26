# CUE public replay evaluation

{
  "qwen": {
    "samples": 82,
    "passed": 69,
    "lengthPassed": 81,
    "semanticPassed": 81,
    "sourceFailures": 5,
    "preparationMs": {
      "count": 82,
      "p50": 14.15,
      "p95": 42.49,
      "max": 86.88
    },
    "firstSentenceMs": {
      "count": 82,
      "p50": 2544.12,
      "p95": 4413.69,
      "max": 5338.45
    },
    "doneMs": {
      "count": 82,
      "p50": 3615.51,
      "p95": 6281.86,
      "max": 6647.87
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 82,
    "passed": 75,
    "lengthPassed": 82,
    "semanticPassed": 81,
    "sourceFailures": 2,
    "preparationMs": {
      "count": 82,
      "p50": 14.6,
      "p95": 40.13,
      "max": 51.52
    },
    "firstSentenceMs": {
      "count": 82,
      "p50": 1374.41,
      "p95": 2559.19,
      "max": 3108.89
    },
    "doneMs": {
      "count": 82,
      "p50": 1881.3,
      "p95": 3374.48,
      "max": 4288.67
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): passed
- [qwen/interview-01 repeat 2](qwen/interview-01-r2/answer.txt): passed
- [qwen/interview-02 repeat 2](qwen/interview-02-r2/answer.txt): passed
- [qwen/interview-02 repeat 1](qwen/interview-02-r1/answer.txt): passed
- [qwen/interview-03 repeat 1](qwen/interview-03-r1/answer.txt): passed
- [qwen/interview-03 repeat 2](qwen/interview-03-r2/answer.txt): passed
- [qwen/interview-04 repeat 1](qwen/interview-04-r1/answer.txt): passed
- [qwen/interview-04 repeat 2](qwen/interview-04-r2/answer.txt): passed
- [qwen/interview-05 repeat 1](qwen/interview-05-r1/answer.txt): passed
- [qwen/interview-05 repeat 2](qwen/interview-05-r2/answer.txt): passed
- [qwen/interview-06 repeat 1](qwen/interview-06-r1/answer.txt): passed
- [qwen/interview-06 repeat 2](qwen/interview-06-r2/answer.txt): passed
- [qwen/interview-07 repeat 1](qwen/interview-07-r1/answer.txt): passed
- [qwen/interview-07 repeat 2](qwen/interview-07-r2/answer.txt): passed
- [qwen/interview-08 repeat 1](qwen/interview-08-r1/answer.txt): passed
- [qwen/interview-08 repeat 2](qwen/interview-08-r2/answer.txt): passed
- [qwen/interview-09 repeat 1](qwen/interview-09-r1/answer.txt): passed
- [qwen/interview-09 repeat 2](qwen/interview-09-r2/answer.txt): passed
- [qwen/interview-10 repeat 1](qwen/interview-10-r1/answer.txt): passed
- [qwen/interview-10 repeat 2](qwen/interview-10-r2/answer.txt): passed
- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): needs review
- [qwen/interview-11 repeat 2](qwen/interview-11-r2/answer.txt): passed
- [qwen/interview-12 repeat 1](qwen/interview-12-r1/answer.txt): passed
- [qwen/interview-12 repeat 2](qwen/interview-12-r2/answer.txt): needs review
- [qwen/interview-13 repeat 1](qwen/interview-13-r1/answer.txt): passed
- [qwen/interview-13 repeat 2](qwen/interview-13-r2/answer.txt): passed
- [qwen/interview-14 repeat 1](qwen/interview-14-r1/answer.txt): passed
- [qwen/interview-14 repeat 2](qwen/interview-14-r2/answer.txt): needs review
- [qwen/interview-15 repeat 1](qwen/interview-15-r1/answer.txt): passed
- [qwen/interview-15 repeat 2](qwen/interview-15-r2/answer.txt): passed
- [qwen/interview-16 repeat 1](qwen/interview-16-r1/answer.txt): passed
- [qwen/interview-16 repeat 2](qwen/interview-16-r2/answer.txt): passed
- [qwen/interview-17 repeat 1](qwen/interview-17-r1/answer.txt): passed
- [qwen/interview-17 repeat 2](qwen/interview-17-r2/answer.txt): passed
- [qwen/interview-18 repeat 1](qwen/interview-18-r1/answer.txt): passed
- [qwen/interview-18 repeat 2](qwen/interview-18-r2/answer.txt): passed
- [qwen/interview-19 repeat 1](qwen/interview-19-r1/answer.txt): needs review
- [qwen/interview-19 repeat 2](qwen/interview-19-r2/answer.txt): needs review
- [qwen/interview-20 repeat 1](qwen/interview-20-r1/answer.txt): needs review
- [qwen/interview-20 repeat 2](qwen/interview-20-r2/answer.txt): passed
- [qwen/interview-21 repeat 1](qwen/interview-21-r1/answer.txt): passed
- [qwen/interview-21 repeat 2](qwen/interview-21-r2/answer.txt): passed
- [qwen/interview-22 repeat 1](qwen/interview-22-r1/answer.txt): needs review
- [qwen/interview-22 repeat 2](qwen/interview-22-r2/answer.txt): passed
- [qwen/interview-23 repeat 1](qwen/interview-23-r1/answer.txt): passed
- [qwen/interview-23 repeat 2](qwen/interview-23-r2/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): passed
- [qwen/interview-24 repeat 2](qwen/interview-24-r2/answer.txt): passed
- [qwen/interview-25 repeat 1](qwen/interview-25-r1/answer.txt): needs review
- [qwen/interview-25 repeat 2](qwen/interview-25-r2/answer.txt): passed
- [qwen/interview-26 repeat 1](qwen/interview-26-r1/answer.txt): passed
- [qwen/interview-26 repeat 2](qwen/interview-26-r2/answer.txt): passed
- [qwen/interview-27 repeat 1](qwen/interview-27-r1/answer.txt): passed
- [qwen/interview-27 repeat 2](qwen/interview-27-r2/answer.txt): passed
- [qwen/interview-28 repeat 1](qwen/interview-28-r1/answer.txt): passed
- [qwen/interview-28 repeat 2](qwen/interview-28-r2/answer.txt): passed
- [qwen/interview-29 repeat 1](qwen/interview-29-r1/answer.txt): passed
- [qwen/interview-29 repeat 2](qwen/interview-29-r2/answer.txt): passed
- [qwen/interview-30 repeat 1](qwen/interview-30-r1/answer.txt): passed
- [qwen/interview-31 repeat 1](qwen/interview-31-r1/answer.txt): needs review
- [qwen/interview-30 repeat 2](qwen/interview-30-r2/answer.txt): passed
- [qwen/interview-31 repeat 2](qwen/interview-31-r2/answer.txt): passed
- [qwen/interview-32 repeat 1](qwen/interview-32-r1/answer.txt): needs review
- [qwen/interview-32 repeat 2](qwen/interview-32-r2/answer.txt): needs review
- [qwen/interview-33 repeat 1](qwen/interview-33-r1/answer.txt): passed
- [qwen/interview-33 repeat 2](qwen/interview-33-r2/answer.txt): needs review
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): passed
- [qwen/interview-34 repeat 2](qwen/interview-34-r2/answer.txt): passed
- [qwen/interview-35 repeat 1](qwen/interview-35-r1/answer.txt): passed
- [qwen/interview-35 repeat 2](qwen/interview-35-r2/answer.txt): passed
- [qwen/interview-36 repeat 1](qwen/interview-36-r1/answer.txt): passed
- [qwen/interview-36 repeat 2](qwen/interview-36-r2/answer.txt): passed
- [qwen/interview-37 repeat 1](qwen/interview-37-r1/answer.txt): passed
- [qwen/interview-37 repeat 2](qwen/interview-37-r2/answer.txt): passed
- [qwen/interview-38 repeat 1](qwen/interview-38-r1/answer.txt): passed
- [qwen/interview-38 repeat 2](qwen/interview-38-r2/answer.txt): needs review
- [qwen/interview-39 repeat 1](qwen/interview-39-r1/answer.txt): passed
- [qwen/interview-39 repeat 2](qwen/interview-39-r2/answer.txt): passed
- [qwen/interview-40 repeat 1](qwen/interview-40-r1/answer.txt): passed
- [qwen/interview-40 repeat 2](qwen/interview-40-r2/answer.txt): passed
- [qwen/interview-41 repeat 1](qwen/interview-41-r1/answer.txt): passed
- [qwen/interview-41 repeat 2](qwen/interview-41-r2/answer.txt): passed
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): passed
- [deepseek/interview-01 repeat 2](deepseek/interview-01-r2/answer.txt): passed
- [deepseek/interview-02 repeat 2](deepseek/interview-02-r2/answer.txt): passed
- [deepseek/interview-02 repeat 1](deepseek/interview-02-r1/answer.txt): needs review
- [deepseek/interview-03 repeat 1](deepseek/interview-03-r1/answer.txt): passed
- [deepseek/interview-03 repeat 2](deepseek/interview-03-r2/answer.txt): passed
- [deepseek/interview-04 repeat 1](deepseek/interview-04-r1/answer.txt): passed
- [deepseek/interview-04 repeat 2](deepseek/interview-04-r2/answer.txt): passed
- [deepseek/interview-05 repeat 1](deepseek/interview-05-r1/answer.txt): passed
- [deepseek/interview-05 repeat 2](deepseek/interview-05-r2/answer.txt): passed
- [deepseek/interview-06 repeat 2](deepseek/interview-06-r2/answer.txt): passed
- [deepseek/interview-06 repeat 1](deepseek/interview-06-r1/answer.txt): passed
- [deepseek/interview-07 repeat 1](deepseek/interview-07-r1/answer.txt): passed
- [deepseek/interview-07 repeat 2](deepseek/interview-07-r2/answer.txt): passed
- [deepseek/interview-08 repeat 2](deepseek/interview-08-r2/answer.txt): needs review
- [deepseek/interview-08 repeat 1](deepseek/interview-08-r1/answer.txt): passed
- [deepseek/interview-09 repeat 2](deepseek/interview-09-r2/answer.txt): passed
- [deepseek/interview-09 repeat 1](deepseek/interview-09-r1/answer.txt): passed
- [deepseek/interview-10 repeat 1](deepseek/interview-10-r1/answer.txt): passed
- [deepseek/interview-10 repeat 2](deepseek/interview-10-r2/answer.txt): passed
- [deepseek/interview-11 repeat 2](deepseek/interview-11-r2/answer.txt): passed
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): passed
- [deepseek/interview-12 repeat 1](deepseek/interview-12-r1/answer.txt): passed
- [deepseek/interview-12 repeat 2](deepseek/interview-12-r2/answer.txt): passed
- [deepseek/interview-13 repeat 1](deepseek/interview-13-r1/answer.txt): passed
- [deepseek/interview-13 repeat 2](deepseek/interview-13-r2/answer.txt): passed
- [deepseek/interview-14 repeat 1](deepseek/interview-14-r1/answer.txt): passed
- [deepseek/interview-14 repeat 2](deepseek/interview-14-r2/answer.txt): passed
- [deepseek/interview-15 repeat 1](deepseek/interview-15-r1/answer.txt): passed
- [deepseek/interview-15 repeat 2](deepseek/interview-15-r2/answer.txt): passed
- [deepseek/interview-16 repeat 1](deepseek/interview-16-r1/answer.txt): passed
- [deepseek/interview-16 repeat 2](deepseek/interview-16-r2/answer.txt): passed
- [deepseek/interview-17 repeat 1](deepseek/interview-17-r1/answer.txt): passed
- [deepseek/interview-17 repeat 2](deepseek/interview-17-r2/answer.txt): passed
- [deepseek/interview-18 repeat 1](deepseek/interview-18-r1/answer.txt): passed
- [deepseek/interview-18 repeat 2](deepseek/interview-18-r2/answer.txt): passed
- [deepseek/interview-19 repeat 1](deepseek/interview-19-r1/answer.txt): needs review
- [deepseek/interview-19 repeat 2](deepseek/interview-19-r2/answer.txt): passed
- [deepseek/interview-20 repeat 1](deepseek/interview-20-r1/answer.txt): passed
- [deepseek/interview-20 repeat 2](deepseek/interview-20-r2/answer.txt): passed
- [deepseek/interview-21 repeat 2](deepseek/interview-21-r2/answer.txt): passed
- [deepseek/interview-21 repeat 1](deepseek/interview-21-r1/answer.txt): passed
- [deepseek/interview-22 repeat 1](deepseek/interview-22-r1/answer.txt): passed
- [deepseek/interview-22 repeat 2](deepseek/interview-22-r2/answer.txt): passed
- [deepseek/interview-23 repeat 1](deepseek/interview-23-r1/answer.txt): needs review
- [deepseek/interview-23 repeat 2](deepseek/interview-23-r2/answer.txt): passed
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/interview-24 repeat 2](deepseek/interview-24-r2/answer.txt): passed
- [deepseek/interview-25 repeat 2](deepseek/interview-25-r2/answer.txt): passed
- [deepseek/interview-25 repeat 1](deepseek/interview-25-r1/answer.txt): needs review
- [deepseek/interview-26 repeat 1](deepseek/interview-26-r1/answer.txt): passed
- [deepseek/interview-26 repeat 2](deepseek/interview-26-r2/answer.txt): passed
- [deepseek/interview-27 repeat 1](deepseek/interview-27-r1/answer.txt): passed
- [deepseek/interview-27 repeat 2](deepseek/interview-27-r2/answer.txt): passed
- [deepseek/interview-28 repeat 1](deepseek/interview-28-r1/answer.txt): passed
- [deepseek/interview-28 repeat 2](deepseek/interview-28-r2/answer.txt): passed
- [deepseek/interview-29 repeat 1](deepseek/interview-29-r1/answer.txt): passed
- [deepseek/interview-29 repeat 2](deepseek/interview-29-r2/answer.txt): passed
- [deepseek/interview-30 repeat 1](deepseek/interview-30-r1/answer.txt): passed
- [deepseek/interview-30 repeat 2](deepseek/interview-30-r2/answer.txt): passed
- [deepseek/interview-31 repeat 1](deepseek/interview-31-r1/answer.txt): passed
- [deepseek/interview-31 repeat 2](deepseek/interview-31-r2/answer.txt): passed
- [deepseek/interview-32 repeat 2](deepseek/interview-32-r2/answer.txt): needs review
- [deepseek/interview-32 repeat 1](deepseek/interview-32-r1/answer.txt): passed
- [deepseek/interview-33 repeat 1](deepseek/interview-33-r1/answer.txt): passed
- [deepseek/interview-33 repeat 2](deepseek/interview-33-r2/answer.txt): needs review
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/interview-34 repeat 2](deepseek/interview-34-r2/answer.txt): passed
- [deepseek/interview-35 repeat 1](deepseek/interview-35-r1/answer.txt): passed
- [deepseek/interview-35 repeat 2](deepseek/interview-35-r2/answer.txt): passed
- [deepseek/interview-36 repeat 1](deepseek/interview-36-r1/answer.txt): passed
- [deepseek/interview-36 repeat 2](deepseek/interview-36-r2/answer.txt): passed
- [deepseek/interview-37 repeat 1](deepseek/interview-37-r1/answer.txt): passed
- [deepseek/interview-37 repeat 2](deepseek/interview-37-r2/answer.txt): passed
- [deepseek/interview-38 repeat 1](deepseek/interview-38-r1/answer.txt): passed
- [deepseek/interview-38 repeat 2](deepseek/interview-38-r2/answer.txt): passed
- [deepseek/interview-39 repeat 1](deepseek/interview-39-r1/answer.txt): passed
- [deepseek/interview-39 repeat 2](deepseek/interview-39-r2/answer.txt): passed
- [deepseek/interview-40 repeat 2](deepseek/interview-40-r2/answer.txt): passed
- [deepseek/interview-40 repeat 1](deepseek/interview-40-r1/answer.txt): passed
- [deepseek/interview-41 repeat 1](deepseek/interview-41-r1/answer.txt): passed
- [deepseek/interview-41 repeat 2](deepseek/interview-41-r2/answer.txt): passed