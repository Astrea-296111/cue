# CUE public full evaluation

{
  "qwen": {
    "samples": 134,
    "passed": 96,
    "lengthPassed": 133,
    "semanticPassed": 126,
    "sourceFailures": 16,
    "preparationMs": {
      "count": 134,
      "p50": 7.91,
      "p95": 17.95,
      "max": 51.9
    },
    "firstSentenceMs": {
      "count": 131,
      "p50": 1535.56,
      "p95": 2699.55,
      "max": 4689.06
    },
    "doneMs": {
      "count": 134,
      "p50": 2714.79,
      "p95": 4977.05,
      "max": 12633.08
    },
    "over8s": 3
  },
  "deepseek": {
    "samples": 134,
    "passed": 119,
    "lengthPassed": 132,
    "semanticPassed": 132,
    "sourceFailures": 4,
    "preparationMs": {
      "count": 134,
      "p50": 7.77,
      "p95": 20.67,
      "max": 30.82
    },
    "firstSentenceMs": {
      "count": 134,
      "p50": 1278.81,
      "p95": 1645.23,
      "max": 2142.56
    },
    "doneMs": {
      "count": 134,
      "p50": 1747.62,
      "p95": 2232.93,
      "max": 2709.93
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-01 repeat 2](qwen/interview-01-r2/answer.txt): needs review
- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): needs review
- [qwen/interview-02 repeat 1](qwen/interview-02-r1/answer.txt): passed
- [qwen/interview-02 repeat 2](qwen/interview-02-r2/answer.txt): passed
- [qwen/interview-03 repeat 1](qwen/interview-03-r1/answer.txt): needs review
- [qwen/interview-03 repeat 2](qwen/interview-03-r2/answer.txt): needs review
- [qwen/interview-04 repeat 1](qwen/interview-04-r1/answer.txt): needs review
- [qwen/interview-04 repeat 2](qwen/interview-04-r2/answer.txt): passed
- [qwen/interview-05 repeat 1](qwen/interview-05-r1/answer.txt): passed
- [qwen/interview-05 repeat 2](qwen/interview-05-r2/answer.txt): passed
- [qwen/interview-06 repeat 1](qwen/interview-06-r1/answer.txt): needs review
- [qwen/interview-06 repeat 2](qwen/interview-06-r2/answer.txt): needs review
- [qwen/interview-07 repeat 1](qwen/interview-07-r1/answer.txt): passed
- [qwen/interview-07 repeat 2](qwen/interview-07-r2/answer.txt): passed
- [qwen/interview-08 repeat 1](qwen/interview-08-r1/answer.txt): passed
- [qwen/interview-08 repeat 2](qwen/interview-08-r2/answer.txt): passed
- [qwen/interview-09 repeat 1](qwen/interview-09-r1/answer.txt): passed
- [qwen/interview-09 repeat 2](qwen/interview-09-r2/answer.txt): passed
- [qwen/interview-10 repeat 1](qwen/interview-10-r1/answer.txt): passed
- [qwen/interview-10 repeat 2](qwen/interview-10-r2/answer.txt): passed
- [qwen/interview-11 repeat 2](qwen/interview-11-r2/answer.txt): passed
- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): needs review
- [qwen/interview-12 repeat 1](qwen/interview-12-r1/answer.txt): passed
- [qwen/interview-12 repeat 2](qwen/interview-12-r2/answer.txt): passed
- [qwen/interview-13 repeat 1](qwen/interview-13-r1/answer.txt): passed
- [qwen/interview-13 repeat 2](qwen/interview-13-r2/answer.txt): passed
- [qwen/interview-14 repeat 1](qwen/interview-14-r1/answer.txt): passed
- [qwen/interview-14 repeat 2](qwen/interview-14-r2/answer.txt): needs review
- [qwen/interview-15 repeat 1](qwen/interview-15-r1/answer.txt): passed
- [qwen/interview-15 repeat 2](qwen/interview-15-r2/answer.txt): needs review
- [qwen/interview-16 repeat 1](qwen/interview-16-r1/answer.txt): passed
- [qwen/interview-16 repeat 2](qwen/interview-16-r2/answer.txt): passed
- [qwen/interview-17 repeat 1](qwen/interview-17-r1/answer.txt): passed
- [qwen/interview-17 repeat 2](qwen/interview-17-r2/answer.txt): passed
- [qwen/interview-18 repeat 1](qwen/interview-18-r1/answer.txt): passed
- [qwen/interview-18 repeat 2](qwen/interview-18-r2/answer.txt): needs review
- [qwen/interview-19 repeat 1](qwen/interview-19-r1/answer.txt): passed
- [qwen/interview-19 repeat 2](qwen/interview-19-r2/answer.txt): passed
- [qwen/interview-20 repeat 1](qwen/interview-20-r1/answer.txt): passed
- [qwen/interview-20 repeat 2](qwen/interview-20-r2/answer.txt): passed
- [qwen/interview-21 repeat 1](qwen/interview-21-r1/answer.txt): needs review
- [qwen/interview-21 repeat 2](qwen/interview-21-r2/answer.txt): needs review
- [qwen/interview-22 repeat 1](qwen/interview-22-r1/answer.txt): needs review
- [qwen/interview-22 repeat 2](qwen/interview-22-r2/answer.txt): needs review
- [qwen/interview-23 repeat 1](qwen/interview-23-r1/answer.txt): needs review
- [qwen/interview-23 repeat 2](qwen/interview-23-r2/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): passed
- [qwen/interview-24 repeat 2](qwen/interview-24-r2/answer.txt): needs review
- [qwen/interview-25 repeat 1](qwen/interview-25-r1/answer.txt): needs review
- [qwen/interview-25 repeat 2](qwen/interview-25-r2/answer.txt): needs review
- [qwen/interview-26 repeat 1](qwen/interview-26-r1/answer.txt): needs review
- [qwen/interview-26 repeat 2](qwen/interview-26-r2/answer.txt): needs review
- [qwen/interview-27 repeat 1](qwen/interview-27-r1/answer.txt): needs review
- [qwen/interview-27 repeat 2](qwen/interview-27-r2/answer.txt): passed
- [qwen/interview-28 repeat 1](qwen/interview-28-r1/answer.txt): passed
- [qwen/interview-28 repeat 2](qwen/interview-28-r2/answer.txt): passed
- [qwen/interview-29 repeat 1](qwen/interview-29-r1/answer.txt): passed
- [qwen/interview-29 repeat 2](qwen/interview-29-r2/answer.txt): needs review
- [qwen/interview-30 repeat 1](qwen/interview-30-r1/answer.txt): passed
- [qwen/interview-31 repeat 1](qwen/interview-31-r1/answer.txt): passed
- [qwen/interview-30 repeat 2](qwen/interview-30-r2/answer.txt): needs review
- [qwen/interview-31 repeat 2](qwen/interview-31-r2/answer.txt): passed
- [qwen/interview-32 repeat 1](qwen/interview-32-r1/answer.txt): needs review
- [qwen/interview-32 repeat 2](qwen/interview-32-r2/answer.txt): needs review
- [qwen/interview-33 repeat 1](qwen/interview-33-r1/answer.txt): passed
- [qwen/interview-33 repeat 2](qwen/interview-33-r2/answer.txt): needs review
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): passed
- [qwen/interview-34 repeat 2](qwen/interview-34-r2/answer.txt): passed
- [qwen/interview-35 repeat 2](qwen/interview-35-r2/answer.txt): passed
- [qwen/interview-35 repeat 1](qwen/interview-35-r1/answer.txt): needs review
- [qwen/interview-36 repeat 1](qwen/interview-36-r1/answer.txt): passed
- [qwen/interview-36 repeat 2](qwen/interview-36-r2/answer.txt): passed
- [qwen/interview-37 repeat 2](qwen/interview-37-r2/answer.txt): passed
- [qwen/interview-37 repeat 1](qwen/interview-37-r1/answer.txt): passed
- [qwen/interview-38 repeat 1](qwen/interview-38-r1/answer.txt): passed
- [qwen/interview-38 repeat 2](qwen/interview-38-r2/answer.txt): needs review
- [qwen/interview-39 repeat 1](qwen/interview-39-r1/answer.txt): passed
- [qwen/interview-39 repeat 2](qwen/interview-39-r2/answer.txt): passed
- [qwen/interview-40 repeat 1](qwen/interview-40-r1/answer.txt): passed
- [qwen/interview-40 repeat 2](qwen/interview-40-r2/answer.txt): passed
- [qwen/interview-41 repeat 1](qwen/interview-41-r1/answer.txt): passed
- [qwen/interview-41 repeat 2](qwen/interview-41-r2/answer.txt): passed
- [qwen/unseen-arclight-01 repeat 1](qwen/unseen-arclight-01-r1/answer.txt): passed
- [qwen/unseen-arclight-01 repeat 2](qwen/unseen-arclight-01-r2/answer.txt): passed
- [qwen/unseen-arclight-02 repeat 1](qwen/unseen-arclight-02-r1/answer.txt): passed
- [qwen/unseen-arclight-02 repeat 2](qwen/unseen-arclight-02-r2/answer.txt): passed
- [qwen/unseen-arclight-03 repeat 1](qwen/unseen-arclight-03-r1/answer.txt): needs review
- [qwen/unseen-arclight-03 repeat 2](qwen/unseen-arclight-03-r2/answer.txt): needs review
- [qwen/unseen-arclight-04 repeat 1](qwen/unseen-arclight-04-r1/answer.txt): passed
- [qwen/unseen-arclight-04 repeat 2](qwen/unseen-arclight-04-r2/answer.txt): needs review
- [qwen/unseen-arclight-05 repeat 1](qwen/unseen-arclight-05-r1/answer.txt): passed
- [qwen/unseen-arclight-05 repeat 2](qwen/unseen-arclight-05-r2/answer.txt): passed
- [qwen/unseen-arclight-06 repeat 1](qwen/unseen-arclight-06-r1/answer.txt): passed
- [qwen/unseen-arclight-06 repeat 2](qwen/unseen-arclight-06-r2/answer.txt): passed
- [qwen/unseen-arclight-07 repeat 1](qwen/unseen-arclight-07-r1/answer.txt): needs review
- [qwen/unseen-arclight-07 repeat 2](qwen/unseen-arclight-07-r2/answer.txt): needs review
- [qwen/unseen-arclight-08 repeat 1](qwen/unseen-arclight-08-r1/answer.txt): passed
- [qwen/unseen-arclight-08 repeat 2](qwen/unseen-arclight-08-r2/answer.txt): passed
- [qwen/unseen-cae-01 repeat 1](qwen/unseen-cae-01-r1/answer.txt): passed
- [qwen/unseen-cae-01 repeat 2](qwen/unseen-cae-01-r2/answer.txt): passed
- [qwen/unseen-cae-02 repeat 1](qwen/unseen-cae-02-r1/answer.txt): needs review
- [qwen/unseen-cae-02 repeat 2](qwen/unseen-cae-02-r2/answer.txt): passed
- [qwen/unseen-cae-03 repeat 1](qwen/unseen-cae-03-r1/answer.txt): passed
- [qwen/unseen-cae-03 repeat 2](qwen/unseen-cae-03-r2/answer.txt): passed
- [qwen/unseen-cae-04 repeat 1](qwen/unseen-cae-04-r1/answer.txt): passed
- [qwen/unseen-cae-04 repeat 2](qwen/unseen-cae-04-r2/answer.txt): passed
- [qwen/unseen-cae-05 repeat 1](qwen/unseen-cae-05-r1/answer.txt): passed
- [qwen/unseen-cae-06 repeat 1](qwen/unseen-cae-06-r1/answer.txt): passed
- [qwen/unseen-cae-05 repeat 2](qwen/unseen-cae-05-r2/answer.txt): needs review
- [qwen/unseen-cae-06 repeat 2](qwen/unseen-cae-06-r2/answer.txt): passed
- [qwen/unseen-cae-07 repeat 1](qwen/unseen-cae-07-r1/answer.txt): passed
- [qwen/unseen-cae-07 repeat 2](qwen/unseen-cae-07-r2/answer.txt): passed
- [qwen/unseen-cae-08 repeat 1](qwen/unseen-cae-08-r1/answer.txt): needs review
- [qwen/unseen-cae-08 repeat 2](qwen/unseen-cae-08-r2/answer.txt): passed
- [qwen/unseen-general-01 repeat 1](qwen/unseen-general-01-r1/answer.txt): passed
- [qwen/unseen-general-02 repeat 1](qwen/unseen-general-02-r1/answer.txt): passed
- [qwen/unseen-general-01 repeat 2](qwen/unseen-general-01-r2/answer.txt): passed
- [qwen/unseen-general-03 repeat 1](qwen/unseen-general-03-r1/answer.txt): passed
- [qwen/unseen-general-02 repeat 2](qwen/unseen-general-02-r2/answer.txt): passed
- [qwen/unseen-general-03 repeat 2](qwen/unseen-general-03-r2/answer.txt): passed
- [qwen/unseen-general-04 repeat 1](qwen/unseen-general-04-r1/answer.txt): passed
- [qwen/unseen-general-04 repeat 2](qwen/unseen-general-04-r2/answer.txt): passed
- [qwen/unseen-general-05 repeat 1](qwen/unseen-general-05-r1/answer.txt): passed
- [qwen/unseen-general-05 repeat 2](qwen/unseen-general-05-r2/answer.txt): passed
- [qwen/unseen-general-06 repeat 1](qwen/unseen-general-06-r1/answer.txt): passed
- [qwen/unseen-general-06 repeat 2](qwen/unseen-general-06-r2/answer.txt): passed
- [qwen/unseen-general-07 repeat 1](qwen/unseen-general-07-r1/answer.txt): passed
- [qwen/unseen-general-07 repeat 2](qwen/unseen-general-07-r2/answer.txt): passed
- [qwen/unseen-general-08 repeat 1](qwen/unseen-general-08-r1/answer.txt): passed
- [qwen/unseen-general-08 repeat 2](qwen/unseen-general-08-r2/answer.txt): passed
- [qwen/unseen-arclight-09 repeat 1](qwen/unseen-arclight-09-r1/answer.txt): needs review
- [qwen/unseen-arclight-09 repeat 2](qwen/unseen-arclight-09-r2/answer.txt): passed
- [qwen/unseen-cae-09 repeat 1](qwen/unseen-cae-09-r1/answer.txt): passed
- [qwen/unseen-cae-09 repeat 2](qwen/unseen-cae-09-r2/answer.txt): passed
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): passed
- [deepseek/interview-01 repeat 2](deepseek/interview-01-r2/answer.txt): needs review
- [deepseek/interview-02 repeat 1](deepseek/interview-02-r1/answer.txt): passed
- [deepseek/interview-02 repeat 2](deepseek/interview-02-r2/answer.txt): passed
- [deepseek/interview-03 repeat 1](deepseek/interview-03-r1/answer.txt): needs review
- [deepseek/interview-03 repeat 2](deepseek/interview-03-r2/answer.txt): passed
- [deepseek/interview-04 repeat 1](deepseek/interview-04-r1/answer.txt): passed
- [deepseek/interview-04 repeat 2](deepseek/interview-04-r2/answer.txt): passed
- [deepseek/interview-05 repeat 2](deepseek/interview-05-r2/answer.txt): passed
- [deepseek/interview-05 repeat 1](deepseek/interview-05-r1/answer.txt): passed
- [deepseek/interview-06 repeat 2](deepseek/interview-06-r2/answer.txt): needs review
- [deepseek/interview-06 repeat 1](deepseek/interview-06-r1/answer.txt): needs review
- [deepseek/interview-07 repeat 1](deepseek/interview-07-r1/answer.txt): passed
- [deepseek/interview-07 repeat 2](deepseek/interview-07-r2/answer.txt): passed
- [deepseek/interview-08 repeat 1](deepseek/interview-08-r1/answer.txt): passed
- [deepseek/interview-08 repeat 2](deepseek/interview-08-r2/answer.txt): needs review
- [deepseek/interview-09 repeat 1](deepseek/interview-09-r1/answer.txt): passed
- [deepseek/interview-09 repeat 2](deepseek/interview-09-r2/answer.txt): passed
- [deepseek/interview-10 repeat 2](deepseek/interview-10-r2/answer.txt): passed
- [deepseek/interview-10 repeat 1](deepseek/interview-10-r1/answer.txt): passed
- [deepseek/interview-11 repeat 2](deepseek/interview-11-r2/answer.txt): passed
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): passed
- [deepseek/interview-12 repeat 2](deepseek/interview-12-r2/answer.txt): passed
- [deepseek/interview-12 repeat 1](deepseek/interview-12-r1/answer.txt): passed
- [deepseek/interview-13 repeat 1](deepseek/interview-13-r1/answer.txt): passed
- [deepseek/interview-13 repeat 2](deepseek/interview-13-r2/answer.txt): passed
- [deepseek/interview-14 repeat 1](deepseek/interview-14-r1/answer.txt): passed
- [deepseek/interview-14 repeat 2](deepseek/interview-14-r2/answer.txt): passed
- [deepseek/interview-15 repeat 1](deepseek/interview-15-r1/answer.txt): passed
- [deepseek/interview-15 repeat 2](deepseek/interview-15-r2/answer.txt): passed
- [deepseek/interview-16 repeat 2](deepseek/interview-16-r2/answer.txt): passed
- [deepseek/interview-16 repeat 1](deepseek/interview-16-r1/answer.txt): passed
- [deepseek/interview-17 repeat 1](deepseek/interview-17-r1/answer.txt): passed
- [deepseek/interview-17 repeat 2](deepseek/interview-17-r2/answer.txt): passed
- [deepseek/interview-18 repeat 2](deepseek/interview-18-r2/answer.txt): passed
- [deepseek/interview-18 repeat 1](deepseek/interview-18-r1/answer.txt): passed
- [deepseek/interview-19 repeat 1](deepseek/interview-19-r1/answer.txt): passed
- [deepseek/interview-19 repeat 2](deepseek/interview-19-r2/answer.txt): passed
- [deepseek/interview-20 repeat 2](deepseek/interview-20-r2/answer.txt): passed
- [deepseek/interview-20 repeat 1](deepseek/interview-20-r1/answer.txt): passed
- [deepseek/interview-21 repeat 1](deepseek/interview-21-r1/answer.txt): passed
- [deepseek/interview-21 repeat 2](deepseek/interview-21-r2/answer.txt): passed
- [deepseek/interview-22 repeat 2](deepseek/interview-22-r2/answer.txt): passed
- [deepseek/interview-22 repeat 1](deepseek/interview-22-r1/answer.txt): passed
- [deepseek/interview-23 repeat 1](deepseek/interview-23-r1/answer.txt): passed
- [deepseek/interview-23 repeat 2](deepseek/interview-23-r2/answer.txt): passed
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/interview-24 repeat 2](deepseek/interview-24-r2/answer.txt): needs review
- [deepseek/interview-25 repeat 1](deepseek/interview-25-r1/answer.txt): needs review
- [deepseek/interview-25 repeat 2](deepseek/interview-25-r2/answer.txt): needs review
- [deepseek/interview-26 repeat 1](deepseek/interview-26-r1/answer.txt): passed
- [deepseek/interview-26 repeat 2](deepseek/interview-26-r2/answer.txt): needs review
- [deepseek/interview-27 repeat 1](deepseek/interview-27-r1/answer.txt): passed
- [deepseek/interview-27 repeat 2](deepseek/interview-27-r2/answer.txt): passed
- [deepseek/interview-28 repeat 1](deepseek/interview-28-r1/answer.txt): passed
- [deepseek/interview-28 repeat 2](deepseek/interview-28-r2/answer.txt): passed
- [deepseek/interview-29 repeat 1](deepseek/interview-29-r1/answer.txt): passed
- [deepseek/interview-29 repeat 2](deepseek/interview-29-r2/answer.txt): needs review
- [deepseek/interview-30 repeat 1](deepseek/interview-30-r1/answer.txt): passed
- [deepseek/interview-30 repeat 2](deepseek/interview-30-r2/answer.txt): needs review
- [deepseek/interview-31 repeat 1](deepseek/interview-31-r1/answer.txt): passed
- [deepseek/interview-31 repeat 2](deepseek/interview-31-r2/answer.txt): passed
- [deepseek/interview-32 repeat 1](deepseek/interview-32-r1/answer.txt): passed
- [deepseek/interview-32 repeat 2](deepseek/interview-32-r2/answer.txt): needs review
- [deepseek/interview-33 repeat 1](deepseek/interview-33-r1/answer.txt): passed
- [deepseek/interview-33 repeat 2](deepseek/interview-33-r2/answer.txt): passed
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/interview-34 repeat 2](deepseek/interview-34-r2/answer.txt): passed
- [deepseek/interview-35 repeat 1](deepseek/interview-35-r1/answer.txt): passed
- [deepseek/interview-36 repeat 1](deepseek/interview-36-r1/answer.txt): passed
- [deepseek/interview-35 repeat 2](deepseek/interview-35-r2/answer.txt): passed
- [deepseek/interview-36 repeat 2](deepseek/interview-36-r2/answer.txt): passed
- [deepseek/interview-37 repeat 1](deepseek/interview-37-r1/answer.txt): passed
- [deepseek/interview-38 repeat 1](deepseek/interview-38-r1/answer.txt): passed
- [deepseek/interview-37 repeat 2](deepseek/interview-37-r2/answer.txt): passed
- [deepseek/interview-38 repeat 2](deepseek/interview-38-r2/answer.txt): passed
- [deepseek/interview-39 repeat 1](deepseek/interview-39-r1/answer.txt): passed
- [deepseek/interview-39 repeat 2](deepseek/interview-39-r2/answer.txt): passed
- [deepseek/interview-40 repeat 1](deepseek/interview-40-r1/answer.txt): passed
- [deepseek/interview-40 repeat 2](deepseek/interview-40-r2/answer.txt): passed
- [deepseek/interview-41 repeat 1](deepseek/interview-41-r1/answer.txt): passed
- [deepseek/interview-41 repeat 2](deepseek/interview-41-r2/answer.txt): passed
- [deepseek/unseen-arclight-01 repeat 1](deepseek/unseen-arclight-01-r1/answer.txt): passed
- [deepseek/unseen-arclight-01 repeat 2](deepseek/unseen-arclight-01-r2/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 1](deepseek/unseen-arclight-02-r1/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 2](deepseek/unseen-arclight-02-r2/answer.txt): passed
- [deepseek/unseen-arclight-03 repeat 1](deepseek/unseen-arclight-03-r1/answer.txt): passed
- [deepseek/unseen-arclight-03 repeat 2](deepseek/unseen-arclight-03-r2/answer.txt): passed
- [deepseek/unseen-arclight-04 repeat 2](deepseek/unseen-arclight-04-r2/answer.txt): passed
- [deepseek/unseen-arclight-04 repeat 1](deepseek/unseen-arclight-04-r1/answer.txt): needs review
- [deepseek/unseen-arclight-05 repeat 2](deepseek/unseen-arclight-05-r2/answer.txt): passed
- [deepseek/unseen-arclight-05 repeat 1](deepseek/unseen-arclight-05-r1/answer.txt): passed
- [deepseek/unseen-arclight-06 repeat 1](deepseek/unseen-arclight-06-r1/answer.txt): passed
- [deepseek/unseen-arclight-06 repeat 2](deepseek/unseen-arclight-06-r2/answer.txt): passed
- [deepseek/unseen-arclight-07 repeat 2](deepseek/unseen-arclight-07-r2/answer.txt): passed
- [deepseek/unseen-arclight-07 repeat 1](deepseek/unseen-arclight-07-r1/answer.txt): passed
- [deepseek/unseen-arclight-08 repeat 1](deepseek/unseen-arclight-08-r1/answer.txt): passed
- [deepseek/unseen-arclight-08 repeat 2](deepseek/unseen-arclight-08-r2/answer.txt): passed
- [deepseek/unseen-cae-01 repeat 2](deepseek/unseen-cae-01-r2/answer.txt): passed
- [deepseek/unseen-cae-01 repeat 1](deepseek/unseen-cae-01-r1/answer.txt): passed
- [deepseek/unseen-cae-02 repeat 2](deepseek/unseen-cae-02-r2/answer.txt): passed
- [deepseek/unseen-cae-02 repeat 1](deepseek/unseen-cae-02-r1/answer.txt): passed
- [deepseek/unseen-cae-03 repeat 1](deepseek/unseen-cae-03-r1/answer.txt): passed
- [deepseek/unseen-cae-03 repeat 2](deepseek/unseen-cae-03-r2/answer.txt): passed
- [deepseek/unseen-cae-04 repeat 1](deepseek/unseen-cae-04-r1/answer.txt): passed
- [deepseek/unseen-cae-05 repeat 1](deepseek/unseen-cae-05-r1/answer.txt): passed
- [deepseek/unseen-cae-04 repeat 2](deepseek/unseen-cae-04-r2/answer.txt): passed
- [deepseek/unseen-cae-06 repeat 1](deepseek/unseen-cae-06-r1/answer.txt): passed
- [deepseek/unseen-cae-05 repeat 2](deepseek/unseen-cae-05-r2/answer.txt): passed
- [deepseek/unseen-cae-06 repeat 2](deepseek/unseen-cae-06-r2/answer.txt): passed
- [deepseek/unseen-cae-07 repeat 1](deepseek/unseen-cae-07-r1/answer.txt): passed
- [deepseek/unseen-cae-07 repeat 2](deepseek/unseen-cae-07-r2/answer.txt): passed
- [deepseek/unseen-cae-08 repeat 1](deepseek/unseen-cae-08-r1/answer.txt): passed
- [deepseek/unseen-cae-08 repeat 2](deepseek/unseen-cae-08-r2/answer.txt): passed
- [deepseek/unseen-general-01 repeat 1](deepseek/unseen-general-01-r1/answer.txt): passed
- [deepseek/unseen-general-01 repeat 2](deepseek/unseen-general-01-r2/answer.txt): passed
- [deepseek/unseen-general-02 repeat 1](deepseek/unseen-general-02-r1/answer.txt): passed
- [deepseek/unseen-general-02 repeat 2](deepseek/unseen-general-02-r2/answer.txt): passed
- [deepseek/unseen-general-03 repeat 1](deepseek/unseen-general-03-r1/answer.txt): passed
- [deepseek/unseen-general-03 repeat 2](deepseek/unseen-general-03-r2/answer.txt): passed
- [deepseek/unseen-general-04 repeat 1](deepseek/unseen-general-04-r1/answer.txt): passed
- [deepseek/unseen-general-05 repeat 1](deepseek/unseen-general-05-r1/answer.txt): passed
- [deepseek/unseen-general-04 repeat 2](deepseek/unseen-general-04-r2/answer.txt): passed
- [deepseek/unseen-general-05 repeat 2](deepseek/unseen-general-05-r2/answer.txt): passed
- [deepseek/unseen-general-06 repeat 1](deepseek/unseen-general-06-r1/answer.txt): passed
- [deepseek/unseen-general-06 repeat 2](deepseek/unseen-general-06-r2/answer.txt): passed
- [deepseek/unseen-general-07 repeat 1](deepseek/unseen-general-07-r1/answer.txt): passed
- [deepseek/unseen-general-07 repeat 2](deepseek/unseen-general-07-r2/answer.txt): passed
- [deepseek/unseen-general-08 repeat 1](deepseek/unseen-general-08-r1/answer.txt): passed
- [deepseek/unseen-general-08 repeat 2](deepseek/unseen-general-08-r2/answer.txt): passed
- [deepseek/unseen-arclight-09 repeat 1](deepseek/unseen-arclight-09-r1/answer.txt): needs review
- [deepseek/unseen-cae-09 repeat 1](deepseek/unseen-cae-09-r1/answer.txt): passed
- [deepseek/unseen-arclight-09 repeat 2](deepseek/unseen-arclight-09-r2/answer.txt): needs review
- [deepseek/unseen-cae-09 repeat 2](deepseek/unseen-cae-09-r2/answer.txt): passed