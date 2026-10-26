# CUE public baseline-acceptance evaluation

{
  "qwen": {
    "samples": 65,
    "passed": 7,
    "lengthPassed": 42,
    "semanticPassed": 60,
    "sourceFailures": 9,
    "preparationMs": {
      "count": 65,
      "p50": 14.4,
      "p95": 38.72,
      "max": 82.21
    },
    "firstSentenceMs": {
      "count": 65,
      "p50": 2371.02,
      "p95": 4315.35,
      "max": 5148
    },
    "doneMs": {
      "count": 65,
      "p50": 4479.54,
      "p95": 7182.24,
      "max": 8494.98
    },
    "over8s": 2
  },
  "deepseek": {
    "samples": 65,
    "passed": 8,
    "lengthPassed": 38,
    "semanticPassed": 64,
    "sourceFailures": 5,
    "preparationMs": {
      "count": 65,
      "p50": 14.17,
      "p95": 32.69,
      "max": 40.43
    },
    "firstSentenceMs": {
      "count": 65,
      "p50": 1318.33,
      "p95": 1931.8,
      "max": 2246.11
    },
    "doneMs": {
      "count": 65,
      "p50": 2312.4,
      "p95": 3813.7,
      "max": 4461.53
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-02 repeat 1](qwen/interview-02-r1/answer.txt): needs review
- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): needs review
- [qwen/interview-03 repeat 1](qwen/interview-03-r1/answer.txt): needs review
- [qwen/interview-04 repeat 1](qwen/interview-04-r1/answer.txt): needs review
- [qwen/interview-05 repeat 1](qwen/interview-05-r1/answer.txt): needs review
- [qwen/interview-07 repeat 1](qwen/interview-07-r1/answer.txt): needs review
- [qwen/interview-06 repeat 1](qwen/interview-06-r1/answer.txt): needs review
- [qwen/interview-08 repeat 1](qwen/interview-08-r1/answer.txt): needs review
- [qwen/interview-09 repeat 1](qwen/interview-09-r1/answer.txt): needs review
- [qwen/interview-10 repeat 1](qwen/interview-10-r1/answer.txt): needs review
- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): needs review
- [qwen/interview-12 repeat 1](qwen/interview-12-r1/answer.txt): needs review
- [qwen/interview-13 repeat 1](qwen/interview-13-r1/answer.txt): needs review
- [qwen/interview-14 repeat 1](qwen/interview-14-r1/answer.txt): needs review
- [qwen/interview-16 repeat 1](qwen/interview-16-r1/answer.txt): passed
- [qwen/interview-15 repeat 1](qwen/interview-15-r1/answer.txt): needs review
- [qwen/interview-17 repeat 1](qwen/interview-17-r1/answer.txt): needs review
- [qwen/interview-18 repeat 1](qwen/interview-18-r1/answer.txt): needs review
- [qwen/interview-19 repeat 1](qwen/interview-19-r1/answer.txt): needs review
- [qwen/interview-20 repeat 1](qwen/interview-20-r1/answer.txt): needs review
- [qwen/interview-21 repeat 1](qwen/interview-21-r1/answer.txt): passed
- [qwen/interview-23 repeat 1](qwen/interview-23-r1/answer.txt): needs review
- [qwen/interview-22 repeat 1](qwen/interview-22-r1/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): needs review
- [qwen/interview-25 repeat 1](qwen/interview-25-r1/answer.txt): needs review
- [qwen/interview-26 repeat 1](qwen/interview-26-r1/answer.txt): passed
- [qwen/interview-27 repeat 1](qwen/interview-27-r1/answer.txt): needs review
- [qwen/interview-28 repeat 1](qwen/interview-28-r1/answer.txt): needs review
- [qwen/interview-29 repeat 1](qwen/interview-29-r1/answer.txt): needs review
- [qwen/interview-30 repeat 1](qwen/interview-30-r1/answer.txt): needs review
- [qwen/interview-31 repeat 1](qwen/interview-31-r1/answer.txt): needs review
- [qwen/interview-32 repeat 1](qwen/interview-32-r1/answer.txt): passed
- [qwen/interview-33 repeat 1](qwen/interview-33-r1/answer.txt): needs review
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): needs review
- [qwen/interview-35 repeat 1](qwen/interview-35-r1/answer.txt): needs review
- [qwen/interview-36 repeat 1](qwen/interview-36-r1/answer.txt): needs review
- [qwen/interview-37 repeat 1](qwen/interview-37-r1/answer.txt): needs review
- [qwen/interview-38 repeat 1](qwen/interview-38-r1/answer.txt): needs review
- [qwen/interview-39 repeat 1](qwen/interview-39-r1/answer.txt): needs review
- [qwen/interview-40 repeat 1](qwen/interview-40-r1/answer.txt): needs review
- [qwen/interview-41 repeat 1](qwen/interview-41-r1/answer.txt): needs review
- [qwen/accept-arclight-01 repeat 1](qwen/accept-arclight-01-r1/answer.txt): needs review
- [qwen/accept-arclight-02 repeat 1](qwen/accept-arclight-02-r1/answer.txt): passed
- [qwen/accept-arclight-03 repeat 1](qwen/accept-arclight-03-r1/answer.txt): needs review
- [qwen/accept-arclight-05 repeat 1](qwen/accept-arclight-05-r1/answer.txt): needs review
- [qwen/accept-arclight-04 repeat 1](qwen/accept-arclight-04-r1/answer.txt): needs review
- [qwen/accept-arclight-06 repeat 1](qwen/accept-arclight-06-r1/answer.txt): needs review
- [qwen/accept-arclight-07 repeat 1](qwen/accept-arclight-07-r1/answer.txt): needs review
- [qwen/accept-arclight-08 repeat 1](qwen/accept-arclight-08-r1/answer.txt): needs review
- [qwen/accept-cae-01 repeat 1](qwen/accept-cae-01-r1/answer.txt): needs review
- [qwen/accept-cae-02 repeat 1](qwen/accept-cae-02-r1/answer.txt): needs review
- [qwen/accept-cae-03 repeat 1](qwen/accept-cae-03-r1/answer.txt): needs review
- [qwen/accept-cae-04 repeat 1](qwen/accept-cae-04-r1/answer.txt): needs review
- [qwen/accept-cae-05 repeat 1](qwen/accept-cae-05-r1/answer.txt): needs review
- [qwen/accept-cae-07 repeat 1](qwen/accept-cae-07-r1/answer.txt): needs review
- [qwen/accept-cae-06 repeat 1](qwen/accept-cae-06-r1/answer.txt): needs review
- [qwen/accept-general-01 repeat 1](qwen/accept-general-01-r1/answer.txt): needs review
- [qwen/accept-cae-08 repeat 1](qwen/accept-cae-08-r1/answer.txt): needs review
- [qwen/accept-general-03 repeat 1](qwen/accept-general-03-r1/answer.txt): needs review
- [qwen/accept-general-02 repeat 1](qwen/accept-general-02-r1/answer.txt): needs review
- [qwen/accept-general-04 repeat 1](qwen/accept-general-04-r1/answer.txt): needs review
- [qwen/accept-general-05 repeat 1](qwen/accept-general-05-r1/answer.txt): needs review
- [qwen/accept-general-06 repeat 1](qwen/accept-general-06-r1/answer.txt): passed
- [qwen/accept-general-07 repeat 1](qwen/accept-general-07-r1/answer.txt): needs review
- [qwen/accept-general-08 repeat 1](qwen/accept-general-08-r1/answer.txt): needs review
- [deepseek/interview-02 repeat 1](deepseek/interview-02-r1/answer.txt): needs review
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): needs review
- [deepseek/interview-03 repeat 1](deepseek/interview-03-r1/answer.txt): passed
- [deepseek/interview-04 repeat 1](deepseek/interview-04-r1/answer.txt): passed
- [deepseek/interview-05 repeat 1](deepseek/interview-05-r1/answer.txt): needs review
- [deepseek/interview-06 repeat 1](deepseek/interview-06-r1/answer.txt): needs review
- [deepseek/interview-08 repeat 1](deepseek/interview-08-r1/answer.txt): needs review
- [deepseek/interview-07 repeat 1](deepseek/interview-07-r1/answer.txt): needs review
- [deepseek/interview-10 repeat 1](deepseek/interview-10-r1/answer.txt): needs review
- [deepseek/interview-09 repeat 1](deepseek/interview-09-r1/answer.txt): needs review
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): needs review
- [deepseek/interview-12 repeat 1](deepseek/interview-12-r1/answer.txt): needs review
- [deepseek/interview-13 repeat 1](deepseek/interview-13-r1/answer.txt): needs review
- [deepseek/interview-14 repeat 1](deepseek/interview-14-r1/answer.txt): needs review
- [deepseek/interview-15 repeat 1](deepseek/interview-15-r1/answer.txt): needs review
- [deepseek/interview-16 repeat 1](deepseek/interview-16-r1/answer.txt): needs review
- [deepseek/interview-17 repeat 1](deepseek/interview-17-r1/answer.txt): needs review
- [deepseek/interview-18 repeat 1](deepseek/interview-18-r1/answer.txt): needs review
- [deepseek/interview-19 repeat 1](deepseek/interview-19-r1/answer.txt): needs review
- [deepseek/interview-20 repeat 1](deepseek/interview-20-r1/answer.txt): needs review
- [deepseek/interview-21 repeat 1](deepseek/interview-21-r1/answer.txt): needs review
- [deepseek/interview-22 repeat 1](deepseek/interview-22-r1/answer.txt): needs review
- [deepseek/interview-23 repeat 1](deepseek/interview-23-r1/answer.txt): needs review
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): needs review
- [deepseek/interview-25 repeat 1](deepseek/interview-25-r1/answer.txt): needs review
- [deepseek/interview-26 repeat 1](deepseek/interview-26-r1/answer.txt): passed
- [deepseek/interview-27 repeat 1](deepseek/interview-27-r1/answer.txt): needs review
- [deepseek/interview-28 repeat 1](deepseek/interview-28-r1/answer.txt): needs review
- [deepseek/interview-29 repeat 1](deepseek/interview-29-r1/answer.txt): needs review
- [deepseek/interview-30 repeat 1](deepseek/interview-30-r1/answer.txt): needs review
- [deepseek/interview-32 repeat 1](deepseek/interview-32-r1/answer.txt): passed
- [deepseek/interview-31 repeat 1](deepseek/interview-31-r1/answer.txt): needs review
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): needs review
- [deepseek/interview-33 repeat 1](deepseek/interview-33-r1/answer.txt): needs review
- [deepseek/interview-36 repeat 1](deepseek/interview-36-r1/answer.txt): needs review
- [deepseek/interview-35 repeat 1](deepseek/interview-35-r1/answer.txt): needs review
- [deepseek/interview-38 repeat 1](deepseek/interview-38-r1/answer.txt): passed
- [deepseek/interview-37 repeat 1](deepseek/interview-37-r1/answer.txt): needs review
- [deepseek/interview-39 repeat 1](deepseek/interview-39-r1/answer.txt): needs review
- [deepseek/interview-40 repeat 1](deepseek/interview-40-r1/answer.txt): needs review
- [deepseek/interview-41 repeat 1](deepseek/interview-41-r1/answer.txt): needs review
- [deepseek/accept-arclight-01 repeat 1](deepseek/accept-arclight-01-r1/answer.txt): passed
- [deepseek/accept-arclight-03 repeat 1](deepseek/accept-arclight-03-r1/answer.txt): needs review
- [deepseek/accept-arclight-02 repeat 1](deepseek/accept-arclight-02-r1/answer.txt): needs review
- [deepseek/accept-arclight-05 repeat 1](deepseek/accept-arclight-05-r1/answer.txt): needs review
- [deepseek/accept-arclight-04 repeat 1](deepseek/accept-arclight-04-r1/answer.txt): needs review
- [deepseek/accept-arclight-06 repeat 1](deepseek/accept-arclight-06-r1/answer.txt): needs review
- [deepseek/accept-arclight-07 repeat 1](deepseek/accept-arclight-07-r1/answer.txt): needs review
- [deepseek/accept-arclight-08 repeat 1](deepseek/accept-arclight-08-r1/answer.txt): needs review
- [deepseek/accept-cae-01 repeat 1](deepseek/accept-cae-01-r1/answer.txt): needs review
- [deepseek/accept-cae-02 repeat 1](deepseek/accept-cae-02-r1/answer.txt): needs review
- [deepseek/accept-cae-03 repeat 1](deepseek/accept-cae-03-r1/answer.txt): needs review
- [deepseek/accept-cae-04 repeat 1](deepseek/accept-cae-04-r1/answer.txt): needs review
- [deepseek/accept-cae-05 repeat 1](deepseek/accept-cae-05-r1/answer.txt): passed
- [deepseek/accept-cae-06 repeat 1](deepseek/accept-cae-06-r1/answer.txt): needs review
- [deepseek/accept-cae-07 repeat 1](deepseek/accept-cae-07-r1/answer.txt): needs review
- [deepseek/accept-cae-08 repeat 1](deepseek/accept-cae-08-r1/answer.txt): needs review
- [deepseek/accept-general-02 repeat 1](deepseek/accept-general-02-r1/answer.txt): passed
- [deepseek/accept-general-01 repeat 1](deepseek/accept-general-01-r1/answer.txt): needs review
- [deepseek/accept-general-03 repeat 1](deepseek/accept-general-03-r1/answer.txt): needs review
- [deepseek/accept-general-04 repeat 1](deepseek/accept-general-04-r1/answer.txt): needs review
- [deepseek/accept-general-05 repeat 1](deepseek/accept-general-05-r1/answer.txt): needs review
- [deepseek/accept-general-06 repeat 1](deepseek/accept-general-06-r1/answer.txt): needs review
- [deepseek/accept-general-07 repeat 1](deepseek/accept-general-07-r1/answer.txt): needs review
- [deepseek/accept-general-08 repeat 1](deepseek/accept-general-08-r1/answer.txt): needs review