# CUE public acceptance evaluation

{
  "qwen": {
    "samples": 130,
    "passed": 117,
    "lengthPassed": 130,
    "semanticPassed": 129,
    "sourceFailures": 6,
    "preparationMs": {
      "count": 130,
      "p50": 11.51,
      "p95": 28.43,
      "max": 53.65
    },
    "firstSentenceMs": {
      "count": 130,
      "p50": 1715.64,
      "p95": 2858.82,
      "max": 3576.39
    },
    "doneMs": {
      "count": 130,
      "p50": 2953.06,
      "p95": 4373.36,
      "max": 4955.59
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 130,
    "passed": 120,
    "lengthPassed": 128,
    "semanticPassed": 129,
    "sourceFailures": 2,
    "preparationMs": {
      "count": 130,
      "p50": 11.19,
      "p95": 25.78,
      "max": 34.29
    },
    "firstSentenceMs": {
      "count": 130,
      "p50": 1289.17,
      "p95": 1949.64,
      "max": 2581.3
    },
    "doneMs": {
      "count": 130,
      "p50": 1771.05,
      "p95": 2616.21,
      "max": 2913.49
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): needs review
- [qwen/interview-01 repeat 2](qwen/interview-01-r2/answer.txt): passed
- [qwen/interview-02 repeat 2](qwen/interview-02-r2/answer.txt): passed
- [qwen/interview-02 repeat 1](qwen/interview-02-r1/answer.txt): passed
- [qwen/interview-03 repeat 2](qwen/interview-03-r2/answer.txt): passed
- [qwen/interview-03 repeat 1](qwen/interview-03-r1/answer.txt): passed
- [qwen/interview-04 repeat 1](qwen/interview-04-r1/answer.txt): passed
- [qwen/interview-04 repeat 2](qwen/interview-04-r2/answer.txt): passed
- [qwen/interview-05 repeat 1](qwen/interview-05-r1/answer.txt): passed
- [qwen/interview-05 repeat 2](qwen/interview-05-r2/answer.txt): passed
- [qwen/interview-06 repeat 1](qwen/interview-06-r1/answer.txt): passed
- [qwen/interview-06 repeat 2](qwen/interview-06-r2/answer.txt): passed
- [qwen/interview-07 repeat 1](qwen/interview-07-r1/answer.txt): passed
- [qwen/interview-07 repeat 2](qwen/interview-07-r2/answer.txt): passed
- [qwen/interview-08 repeat 2](qwen/interview-08-r2/answer.txt): needs review
- [qwen/interview-08 repeat 1](qwen/interview-08-r1/answer.txt): passed
- [qwen/interview-09 repeat 1](qwen/interview-09-r1/answer.txt): passed
- [qwen/interview-09 repeat 2](qwen/interview-09-r2/answer.txt): passed
- [qwen/interview-10 repeat 1](qwen/interview-10-r1/answer.txt): passed
- [qwen/interview-10 repeat 2](qwen/interview-10-r2/answer.txt): passed
- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): passed
- [qwen/interview-11 repeat 2](qwen/interview-11-r2/answer.txt): passed
- [qwen/interview-12 repeat 1](qwen/interview-12-r1/answer.txt): passed
- [qwen/interview-12 repeat 2](qwen/interview-12-r2/answer.txt): passed
- [qwen/interview-13 repeat 1](qwen/interview-13-r1/answer.txt): passed
- [qwen/interview-13 repeat 2](qwen/interview-13-r2/answer.txt): passed
- [qwen/interview-14 repeat 1](qwen/interview-14-r1/answer.txt): passed
- [qwen/interview-14 repeat 2](qwen/interview-14-r2/answer.txt): needs review
- [qwen/interview-15 repeat 1](qwen/interview-15-r1/answer.txt): passed
- [qwen/interview-16 repeat 1](qwen/interview-16-r1/answer.txt): passed
- [qwen/interview-15 repeat 2](qwen/interview-15-r2/answer.txt): passed
- [qwen/interview-17 repeat 1](qwen/interview-17-r1/answer.txt): passed
- [qwen/interview-16 repeat 2](qwen/interview-16-r2/answer.txt): passed
- [qwen/interview-17 repeat 2](qwen/interview-17-r2/answer.txt): passed
- [qwen/interview-18 repeat 1](qwen/interview-18-r1/answer.txt): passed
- [qwen/interview-18 repeat 2](qwen/interview-18-r2/answer.txt): needs review
- [qwen/interview-19 repeat 1](qwen/interview-19-r1/answer.txt): passed
- [qwen/interview-19 repeat 2](qwen/interview-19-r2/answer.txt): passed
- [qwen/interview-20 repeat 1](qwen/interview-20-r1/answer.txt): passed
- [qwen/interview-20 repeat 2](qwen/interview-20-r2/answer.txt): passed
- [qwen/interview-21 repeat 1](qwen/interview-21-r1/answer.txt): passed
- [qwen/interview-21 repeat 2](qwen/interview-21-r2/answer.txt): passed
- [qwen/interview-22 repeat 1](qwen/interview-22-r1/answer.txt): passed
- [qwen/interview-22 repeat 2](qwen/interview-22-r2/answer.txt): passed
- [qwen/interview-23 repeat 1](qwen/interview-23-r1/answer.txt): passed
- [qwen/interview-23 repeat 2](qwen/interview-23-r2/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): passed
- [qwen/interview-24 repeat 2](qwen/interview-24-r2/answer.txt): needs review
- [qwen/interview-25 repeat 1](qwen/interview-25-r1/answer.txt): needs review
- [qwen/interview-25 repeat 2](qwen/interview-25-r2/answer.txt): passed
- [qwen/interview-26 repeat 1](qwen/interview-26-r1/answer.txt): passed
- [qwen/interview-26 repeat 2](qwen/interview-26-r2/answer.txt): passed
- [qwen/interview-27 repeat 1](qwen/interview-27-r1/answer.txt): passed
- [qwen/interview-27 repeat 2](qwen/interview-27-r2/answer.txt): passed
- [qwen/interview-28 repeat 1](qwen/interview-28-r1/answer.txt): passed
- [qwen/interview-28 repeat 2](qwen/interview-28-r2/answer.txt): passed
- [qwen/interview-29 repeat 1](qwen/interview-29-r1/answer.txt): needs review
- [qwen/interview-29 repeat 2](qwen/interview-29-r2/answer.txt): passed
- [qwen/interview-30 repeat 1](qwen/interview-30-r1/answer.txt): passed
- [qwen/interview-30 repeat 2](qwen/interview-30-r2/answer.txt): passed
- [qwen/interview-31 repeat 1](qwen/interview-31-r1/answer.txt): needs review
- [qwen/interview-31 repeat 2](qwen/interview-31-r2/answer.txt): passed
- [qwen/interview-32 repeat 1](qwen/interview-32-r1/answer.txt): needs review
- [qwen/interview-32 repeat 2](qwen/interview-32-r2/answer.txt): passed
- [qwen/interview-33 repeat 1](qwen/interview-33-r1/answer.txt): passed
- [qwen/interview-33 repeat 2](qwen/interview-33-r2/answer.txt): passed
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): passed
- [qwen/interview-34 repeat 2](qwen/interview-34-r2/answer.txt): passed
- [qwen/interview-35 repeat 1](qwen/interview-35-r1/answer.txt): needs review
- [qwen/interview-35 repeat 2](qwen/interview-35-r2/answer.txt): passed
- [qwen/interview-36 repeat 1](qwen/interview-36-r1/answer.txt): passed
- [qwen/interview-36 repeat 2](qwen/interview-36-r2/answer.txt): passed
- [qwen/interview-37 repeat 1](qwen/interview-37-r1/answer.txt): passed
- [qwen/interview-37 repeat 2](qwen/interview-37-r2/answer.txt): passed
- [qwen/interview-38 repeat 1](qwen/interview-38-r1/answer.txt): passed
- [qwen/interview-38 repeat 2](qwen/interview-38-r2/answer.txt): passed
- [qwen/interview-39 repeat 1](qwen/interview-39-r1/answer.txt): passed
- [qwen/interview-39 repeat 2](qwen/interview-39-r2/answer.txt): passed
- [qwen/interview-40 repeat 1](qwen/interview-40-r1/answer.txt): passed
- [qwen/interview-40 repeat 2](qwen/interview-40-r2/answer.txt): passed
- [qwen/interview-41 repeat 1](qwen/interview-41-r1/answer.txt): passed
- [qwen/interview-41 repeat 2](qwen/interview-41-r2/answer.txt): passed
- [qwen/accept-arclight-01 repeat 1](qwen/accept-arclight-01-r1/answer.txt): needs review
- [qwen/accept-arclight-01 repeat 2](qwen/accept-arclight-01-r2/answer.txt): needs review
- [qwen/accept-arclight-02 repeat 1](qwen/accept-arclight-02-r1/answer.txt): passed
- [qwen/accept-arclight-02 repeat 2](qwen/accept-arclight-02-r2/answer.txt): passed
- [qwen/accept-arclight-03 repeat 1](qwen/accept-arclight-03-r1/answer.txt): passed
- [qwen/accept-arclight-03 repeat 2](qwen/accept-arclight-03-r2/answer.txt): passed
- [qwen/accept-arclight-04 repeat 1](qwen/accept-arclight-04-r1/answer.txt): passed
- [qwen/accept-arclight-04 repeat 2](qwen/accept-arclight-04-r2/answer.txt): passed
- [qwen/accept-arclight-05 repeat 1](qwen/accept-arclight-05-r1/answer.txt): passed
- [qwen/accept-arclight-05 repeat 2](qwen/accept-arclight-05-r2/answer.txt): passed
- [qwen/accept-arclight-06 repeat 1](qwen/accept-arclight-06-r1/answer.txt): passed
- [qwen/accept-arclight-06 repeat 2](qwen/accept-arclight-06-r2/answer.txt): passed
- [qwen/accept-arclight-07 repeat 1](qwen/accept-arclight-07-r1/answer.txt): passed
- [qwen/accept-arclight-07 repeat 2](qwen/accept-arclight-07-r2/answer.txt): passed
- [qwen/accept-arclight-08 repeat 1](qwen/accept-arclight-08-r1/answer.txt): passed
- [qwen/accept-arclight-08 repeat 2](qwen/accept-arclight-08-r2/answer.txt): passed
- [qwen/accept-cae-01 repeat 1](qwen/accept-cae-01-r1/answer.txt): passed
- [qwen/accept-cae-01 repeat 2](qwen/accept-cae-01-r2/answer.txt): passed
- [qwen/accept-cae-02 repeat 1](qwen/accept-cae-02-r1/answer.txt): passed
- [qwen/accept-cae-02 repeat 2](qwen/accept-cae-02-r2/answer.txt): passed
- [qwen/accept-cae-03 repeat 1](qwen/accept-cae-03-r1/answer.txt): passed
- [qwen/accept-cae-03 repeat 2](qwen/accept-cae-03-r2/answer.txt): passed
- [qwen/accept-cae-04 repeat 1](qwen/accept-cae-04-r1/answer.txt): passed
- [qwen/accept-cae-04 repeat 2](qwen/accept-cae-04-r2/answer.txt): passed
- [qwen/accept-cae-05 repeat 1](qwen/accept-cae-05-r1/answer.txt): passed
- [qwen/accept-cae-06 repeat 1](qwen/accept-cae-06-r1/answer.txt): passed
- [qwen/accept-cae-05 repeat 2](qwen/accept-cae-05-r2/answer.txt): passed
- [qwen/accept-cae-07 repeat 1](qwen/accept-cae-07-r1/answer.txt): passed
- [qwen/accept-cae-06 repeat 2](qwen/accept-cae-06-r2/answer.txt): passed
- [qwen/accept-cae-07 repeat 2](qwen/accept-cae-07-r2/answer.txt): passed
- [qwen/accept-cae-08 repeat 1](qwen/accept-cae-08-r1/answer.txt): passed
- [qwen/accept-cae-08 repeat 2](qwen/accept-cae-08-r2/answer.txt): passed
- [qwen/accept-general-01 repeat 1](qwen/accept-general-01-r1/answer.txt): passed
- [qwen/accept-general-01 repeat 2](qwen/accept-general-01-r2/answer.txt): passed
- [qwen/accept-general-02 repeat 1](qwen/accept-general-02-r1/answer.txt): passed
- [qwen/accept-general-03 repeat 1](qwen/accept-general-03-r1/answer.txt): passed
- [qwen/accept-general-02 repeat 2](qwen/accept-general-02-r2/answer.txt): passed
- [qwen/accept-general-03 repeat 2](qwen/accept-general-03-r2/answer.txt): passed
- [qwen/accept-general-04 repeat 1](qwen/accept-general-04-r1/answer.txt): passed
- [qwen/accept-general-04 repeat 2](qwen/accept-general-04-r2/answer.txt): passed
- [qwen/accept-general-05 repeat 1](qwen/accept-general-05-r1/answer.txt): passed
- [qwen/accept-general-05 repeat 2](qwen/accept-general-05-r2/answer.txt): needs review
- [qwen/accept-general-06 repeat 1](qwen/accept-general-06-r1/answer.txt): passed
- [qwen/accept-general-06 repeat 2](qwen/accept-general-06-r2/answer.txt): passed
- [qwen/accept-general-07 repeat 1](qwen/accept-general-07-r1/answer.txt): passed
- [qwen/accept-general-07 repeat 2](qwen/accept-general-07-r2/answer.txt): passed
- [qwen/accept-general-08 repeat 1](qwen/accept-general-08-r1/answer.txt): passed
- [qwen/accept-general-08 repeat 2](qwen/accept-general-08-r2/answer.txt): passed
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): passed
- [deepseek/interview-01 repeat 2](deepseek/interview-01-r2/answer.txt): passed
- [deepseek/interview-02 repeat 1](deepseek/interview-02-r1/answer.txt): passed
- [deepseek/interview-02 repeat 2](deepseek/interview-02-r2/answer.txt): passed
- [deepseek/interview-03 repeat 1](deepseek/interview-03-r1/answer.txt): passed
- [deepseek/interview-03 repeat 2](deepseek/interview-03-r2/answer.txt): passed
- [deepseek/interview-04 repeat 1](deepseek/interview-04-r1/answer.txt): passed
- [deepseek/interview-04 repeat 2](deepseek/interview-04-r2/answer.txt): passed
- [deepseek/interview-05 repeat 1](deepseek/interview-05-r1/answer.txt): passed
- [deepseek/interview-05 repeat 2](deepseek/interview-05-r2/answer.txt): passed
- [deepseek/interview-06 repeat 1](deepseek/interview-06-r1/answer.txt): passed
- [deepseek/interview-06 repeat 2](deepseek/interview-06-r2/answer.txt): passed
- [deepseek/interview-07 repeat 1](deepseek/interview-07-r1/answer.txt): passed
- [deepseek/interview-07 repeat 2](deepseek/interview-07-r2/answer.txt): passed
- [deepseek/interview-08 repeat 1](deepseek/interview-08-r1/answer.txt): passed
- [deepseek/interview-08 repeat 2](deepseek/interview-08-r2/answer.txt): passed
- [deepseek/interview-09 repeat 1](deepseek/interview-09-r1/answer.txt): passed
- [deepseek/interview-09 repeat 2](deepseek/interview-09-r2/answer.txt): passed
- [deepseek/interview-10 repeat 1](deepseek/interview-10-r1/answer.txt): passed
- [deepseek/interview-10 repeat 2](deepseek/interview-10-r2/answer.txt): passed
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): passed
- [deepseek/interview-11 repeat 2](deepseek/interview-11-r2/answer.txt): passed
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
- [deepseek/interview-19 repeat 1](deepseek/interview-19-r1/answer.txt): passed
- [deepseek/interview-19 repeat 2](deepseek/interview-19-r2/answer.txt): passed
- [deepseek/interview-20 repeat 1](deepseek/interview-20-r1/answer.txt): passed
- [deepseek/interview-20 repeat 2](deepseek/interview-20-r2/answer.txt): passed
- [deepseek/interview-21 repeat 1](deepseek/interview-21-r1/answer.txt): passed
- [deepseek/interview-21 repeat 2](deepseek/interview-21-r2/answer.txt): passed
- [deepseek/interview-22 repeat 1](deepseek/interview-22-r1/answer.txt): passed
- [deepseek/interview-22 repeat 2](deepseek/interview-22-r2/answer.txt): passed
- [deepseek/interview-23 repeat 1](deepseek/interview-23-r1/answer.txt): passed
- [deepseek/interview-23 repeat 2](deepseek/interview-23-r2/answer.txt): passed
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/interview-24 repeat 2](deepseek/interview-24-r2/answer.txt): passed
- [deepseek/interview-25 repeat 1](deepseek/interview-25-r1/answer.txt): passed
- [deepseek/interview-25 repeat 2](deepseek/interview-25-r2/answer.txt): needs review
- [deepseek/interview-26 repeat 1](deepseek/interview-26-r1/answer.txt): passed
- [deepseek/interview-26 repeat 2](deepseek/interview-26-r2/answer.txt): needs review
- [deepseek/interview-27 repeat 1](deepseek/interview-27-r1/answer.txt): needs review
- [deepseek/interview-27 repeat 2](deepseek/interview-27-r2/answer.txt): passed
- [deepseek/interview-28 repeat 1](deepseek/interview-28-r1/answer.txt): passed
- [deepseek/interview-28 repeat 2](deepseek/interview-28-r2/answer.txt): passed
- [deepseek/interview-29 repeat 1](deepseek/interview-29-r1/answer.txt): passed
- [deepseek/interview-29 repeat 2](deepseek/interview-29-r2/answer.txt): passed
- [deepseek/interview-30 repeat 1](deepseek/interview-30-r1/answer.txt): passed
- [deepseek/interview-30 repeat 2](deepseek/interview-30-r2/answer.txt): needs review
- [deepseek/interview-31 repeat 1](deepseek/interview-31-r1/answer.txt): needs review
- [deepseek/interview-31 repeat 2](deepseek/interview-31-r2/answer.txt): passed
- [deepseek/interview-32 repeat 1](deepseek/interview-32-r1/answer.txt): needs review
- [deepseek/interview-32 repeat 2](deepseek/interview-32-r2/answer.txt): needs review
- [deepseek/interview-33 repeat 1](deepseek/interview-33-r1/answer.txt): passed
- [deepseek/interview-33 repeat 2](deepseek/interview-33-r2/answer.txt): passed
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): needs review
- [deepseek/interview-34 repeat 2](deepseek/interview-34-r2/answer.txt): passed
- [deepseek/interview-35 repeat 1](deepseek/interview-35-r1/answer.txt): passed
- [deepseek/interview-35 repeat 2](deepseek/interview-35-r2/answer.txt): passed
- [deepseek/interview-36 repeat 1](deepseek/interview-36-r1/answer.txt): passed
- [deepseek/interview-36 repeat 2](deepseek/interview-36-r2/answer.txt): passed
- [deepseek/interview-37 repeat 1](deepseek/interview-37-r1/answer.txt): passed
- [deepseek/interview-37 repeat 2](deepseek/interview-37-r2/answer.txt): passed
- [deepseek/interview-38 repeat 1](deepseek/interview-38-r1/answer.txt): passed
- [deepseek/interview-38 repeat 2](deepseek/interview-38-r2/answer.txt): needs review
- [deepseek/interview-39 repeat 1](deepseek/interview-39-r1/answer.txt): passed
- [deepseek/interview-39 repeat 2](deepseek/interview-39-r2/answer.txt): passed
- [deepseek/interview-40 repeat 1](deepseek/interview-40-r1/answer.txt): passed
- [deepseek/interview-40 repeat 2](deepseek/interview-40-r2/answer.txt): passed
- [deepseek/interview-41 repeat 1](deepseek/interview-41-r1/answer.txt): passed
- [deepseek/interview-41 repeat 2](deepseek/interview-41-r2/answer.txt): passed
- [deepseek/accept-arclight-01 repeat 1](deepseek/accept-arclight-01-r1/answer.txt): passed
- [deepseek/accept-arclight-01 repeat 2](deepseek/accept-arclight-01-r2/answer.txt): passed
- [deepseek/accept-arclight-02 repeat 1](deepseek/accept-arclight-02-r1/answer.txt): passed
- [deepseek/accept-arclight-02 repeat 2](deepseek/accept-arclight-02-r2/answer.txt): passed
- [deepseek/accept-arclight-03 repeat 1](deepseek/accept-arclight-03-r1/answer.txt): passed
- [deepseek/accept-arclight-03 repeat 2](deepseek/accept-arclight-03-r2/answer.txt): passed
- [deepseek/accept-arclight-04 repeat 1](deepseek/accept-arclight-04-r1/answer.txt): passed
- [deepseek/accept-arclight-04 repeat 2](deepseek/accept-arclight-04-r2/answer.txt): passed
- [deepseek/accept-arclight-05 repeat 1](deepseek/accept-arclight-05-r1/answer.txt): passed
- [deepseek/accept-arclight-05 repeat 2](deepseek/accept-arclight-05-r2/answer.txt): passed
- [deepseek/accept-arclight-06 repeat 1](deepseek/accept-arclight-06-r1/answer.txt): passed
- [deepseek/accept-arclight-06 repeat 2](deepseek/accept-arclight-06-r2/answer.txt): passed
- [deepseek/accept-arclight-07 repeat 1](deepseek/accept-arclight-07-r1/answer.txt): passed
- [deepseek/accept-arclight-07 repeat 2](deepseek/accept-arclight-07-r2/answer.txt): passed
- [deepseek/accept-arclight-08 repeat 1](deepseek/accept-arclight-08-r1/answer.txt): needs review
- [deepseek/accept-arclight-08 repeat 2](deepseek/accept-arclight-08-r2/answer.txt): passed
- [deepseek/accept-cae-01 repeat 1](deepseek/accept-cae-01-r1/answer.txt): passed
- [deepseek/accept-cae-01 repeat 2](deepseek/accept-cae-01-r2/answer.txt): passed
- [deepseek/accept-cae-02 repeat 1](deepseek/accept-cae-02-r1/answer.txt): passed
- [deepseek/accept-cae-02 repeat 2](deepseek/accept-cae-02-r2/answer.txt): passed
- [deepseek/accept-cae-03 repeat 1](deepseek/accept-cae-03-r1/answer.txt): passed
- [deepseek/accept-cae-03 repeat 2](deepseek/accept-cae-03-r2/answer.txt): passed
- [deepseek/accept-cae-04 repeat 1](deepseek/accept-cae-04-r1/answer.txt): passed
- [deepseek/accept-cae-04 repeat 2](deepseek/accept-cae-04-r2/answer.txt): passed
- [deepseek/accept-cae-05 repeat 1](deepseek/accept-cae-05-r1/answer.txt): passed
- [deepseek/accept-cae-05 repeat 2](deepseek/accept-cae-05-r2/answer.txt): passed
- [deepseek/accept-cae-06 repeat 1](deepseek/accept-cae-06-r1/answer.txt): passed
- [deepseek/accept-cae-06 repeat 2](deepseek/accept-cae-06-r2/answer.txt): passed
- [deepseek/accept-cae-07 repeat 1](deepseek/accept-cae-07-r1/answer.txt): passed
- [deepseek/accept-cae-07 repeat 2](deepseek/accept-cae-07-r2/answer.txt): passed
- [deepseek/accept-cae-08 repeat 1](deepseek/accept-cae-08-r1/answer.txt): passed
- [deepseek/accept-cae-08 repeat 2](deepseek/accept-cae-08-r2/answer.txt): passed
- [deepseek/accept-general-01 repeat 1](deepseek/accept-general-01-r1/answer.txt): passed
- [deepseek/accept-general-01 repeat 2](deepseek/accept-general-01-r2/answer.txt): passed
- [deepseek/accept-general-02 repeat 1](deepseek/accept-general-02-r1/answer.txt): passed
- [deepseek/accept-general-02 repeat 2](deepseek/accept-general-02-r2/answer.txt): passed
- [deepseek/accept-general-03 repeat 1](deepseek/accept-general-03-r1/answer.txt): passed
- [deepseek/accept-general-03 repeat 2](deepseek/accept-general-03-r2/answer.txt): passed
- [deepseek/accept-general-04 repeat 1](deepseek/accept-general-04-r1/answer.txt): passed
- [deepseek/accept-general-04 repeat 2](deepseek/accept-general-04-r2/answer.txt): passed
- [deepseek/accept-general-05 repeat 1](deepseek/accept-general-05-r1/answer.txt): passed
- [deepseek/accept-general-05 repeat 2](deepseek/accept-general-05-r2/answer.txt): passed
- [deepseek/accept-general-06 repeat 1](deepseek/accept-general-06-r1/answer.txt): passed
- [deepseek/accept-general-06 repeat 2](deepseek/accept-general-06-r2/answer.txt): passed
- [deepseek/accept-general-07 repeat 1](deepseek/accept-general-07-r1/answer.txt): passed
- [deepseek/accept-general-07 repeat 2](deepseek/accept-general-07-r2/answer.txt): passed
- [deepseek/accept-general-08 repeat 1](deepseek/accept-general-08-r1/answer.txt): passed
- [deepseek/accept-general-08 repeat 2](deepseek/accept-general-08-r2/answer.txt): passed