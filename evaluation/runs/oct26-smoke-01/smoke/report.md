# CUE public smoke evaluation

{
  "qwen": {
    "samples": 6,
    "passed": 1,
    "lengthPassed": 6,
    "semanticPassed": 3,
    "sourceFailures": 3,
    "preparationMs": {
      "count": 6,
      "p50": 17.4,
      "p95": 90.85,
      "max": 90.85
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 2208.09,
      "p95": 4689.53,
      "max": 4689.53
    },
    "doneMs": {
      "count": 6,
      "p50": 3197.17,
      "p95": 5427.79,
      "max": 5427.79
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 6,
    "passed": 1,
    "lengthPassed": 6,
    "semanticPassed": 5,
    "sourceFailures": 0,
    "preparationMs": {
      "count": 6,
      "p50": 11.01,
      "p95": 19.16,
      "max": 19.16
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1437.81,
      "p95": 1711.22,
      "max": 1711.22
    },
    "doneMs": {
      "count": 6,
      "p50": 1802.58,
      "p95": 2169.77,
      "max": 2169.77
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): needs review
- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): needs review
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): passed
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): needs review
- [qwen/unseen-arclight-02 repeat 1](qwen/unseen-arclight-02-r1/answer.txt): needs review
- [qwen/unseen-general-04 repeat 1](qwen/unseen-general-04-r1/answer.txt): needs review
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): needs review
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): needs review
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): needs review
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 1](deepseek/unseen-arclight-02-r1/answer.txt): needs review
- [deepseek/unseen-general-04 repeat 1](deepseek/unseen-general-04-r1/answer.txt): needs review