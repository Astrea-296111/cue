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
      "p50": 13.17,
      "p95": 77.29,
      "max": 77.29
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1946.18,
      "p95": 3862.4,
      "max": 3862.4
    },
    "doneMs": {
      "count": 6,
      "p50": 2911.34,
      "p95": 4495.26,
      "max": 4495.26
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
      "p50": 9.81,
      "p95": 27.82,
      "max": 27.82
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1276.87,
      "p95": 2650.77,
      "max": 2650.77
    },
    "doneMs": {
      "count": 6,
      "p50": 1590.89,
      "p95": 3066.57,
      "max": 3066.57
    },
    "over8s": 0
  }
}

Status: passed

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): passed
- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): passed
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): passed
- [qwen/unseen-arclight-02 repeat 1](qwen/unseen-arclight-02-r1/answer.txt): passed
- [qwen/unseen-general-04 repeat 1](qwen/unseen-general-04-r1/answer.txt): passed
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): passed
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): passed
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/unseen-general-04 repeat 1](deepseek/unseen-general-04-r1/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 1](deepseek/unseen-arclight-02-r1/answer.txt): passed