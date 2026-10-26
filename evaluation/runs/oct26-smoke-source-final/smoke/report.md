# CUE public smoke evaluation

{
  "qwen": {
    "samples": 6,
    "passed": 6,
    "lengthPassed": 6,
    "semanticPassed": 6,
    "sourceFailures": 0,
    "preparationMs": {
      "count": 6,
      "p50": 11.12,
      "p95": 59.11,
      "max": 59.11
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1746.73,
      "p95": 2309.11,
      "max": 2309.11
    },
    "doneMs": {
      "count": 6,
      "p50": 3026.14,
      "p95": 3824.93,
      "max": 3824.93
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 6,
    "passed": 6,
    "lengthPassed": 6,
    "semanticPassed": 6,
    "sourceFailures": 0,
    "preparationMs": {
      "count": 6,
      "p50": 7.63,
      "p95": 20.25,
      "max": 20.25
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1130.27,
      "p95": 1414.25,
      "max": 1414.25
    },
    "doneMs": {
      "count": 6,
      "p50": 1545.6,
      "p95": 1960.54,
      "max": 1960.54
    },
    "over8s": 0
  }
}

Status: passed

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): passed
- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): passed
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): passed
- [qwen/unseen-arclight-02 repeat 1](qwen/unseen-arclight-02-r1/answer.txt): passed
- [qwen/unseen-general-04 repeat 1](qwen/unseen-general-04-r1/answer.txt): passed
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): passed
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): passed
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/unseen-general-04 repeat 1](deepseek/unseen-general-04-r1/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 1](deepseek/unseen-arclight-02-r1/answer.txt): passed