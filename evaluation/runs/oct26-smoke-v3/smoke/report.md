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
      "p50": 14.15,
      "p95": 89.28,
      "max": 89.28
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 2900.21,
      "p95": 4539.69,
      "max": 4539.69
    },
    "doneMs": {
      "count": 6,
      "p50": 3901.06,
      "p95": 5016.91,
      "max": 5016.91
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
      "p50": 11.68,
      "p95": 31.81,
      "max": 31.81
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1068.53,
      "p95": 1721.31,
      "max": 1721.31
    },
    "doneMs": {
      "count": 6,
      "p50": 1412.27,
      "p95": 2022.17,
      "max": 2022.17
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
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 1](deepseek/unseen-arclight-02-r1/answer.txt): passed
- [deepseek/unseen-general-04 repeat 1](deepseek/unseen-general-04-r1/answer.txt): passed