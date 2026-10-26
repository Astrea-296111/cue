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
      "p50": 8.61,
      "p95": 47.67,
      "max": 47.67
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1586.58,
      "p95": 4763.17,
      "max": 4763.17
    },
    "doneMs": {
      "count": 6,
      "p50": 2544.69,
      "p95": 5368.4,
      "max": 5368.4
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
      "p50": 8.05,
      "p95": 21.31,
      "max": 21.31
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1446.05,
      "p95": 1626.4,
      "max": 1626.4
    },
    "doneMs": {
      "count": 6,
      "p50": 1908.46,
      "p95": 2478.22,
      "max": 2478.22
    },
    "over8s": 0
  }
}

Status: passed

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): passed
- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): passed
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): passed
- [qwen/unseen-general-04 repeat 1](qwen/unseen-general-04-r1/answer.txt): passed
- [qwen/unseen-arclight-02 repeat 1](qwen/unseen-arclight-02-r1/answer.txt): passed
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): passed
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): passed
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 1](deepseek/unseen-arclight-02-r1/answer.txt): passed
- [deepseek/unseen-general-04 repeat 1](deepseek/unseen-general-04-r1/answer.txt): passed