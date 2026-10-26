# CUE public smoke evaluation

{
  "qwen": {
    "samples": 6,
    "passed": 1,
    "lengthPassed": 6,
    "semanticPassed": 4,
    "sourceFailures": 1,
    "preparationMs": {
      "count": 6,
      "p50": 9.41,
      "p95": 54,
      "max": 54
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1808.29,
      "p95": 2566.65,
      "max": 2566.65
    },
    "doneMs": {
      "count": 6,
      "p50": 2774.42,
      "p95": 3552.47,
      "max": 3552.47
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
      "p50": 6.54,
      "p95": 16.24,
      "max": 16.24
    },
    "firstSentenceMs": {
      "count": 6,
      "p50": 1538.48,
      "p95": 1605.31,
      "max": 1605.31
    },
    "doneMs": {
      "count": 6,
      "p50": 1895.45,
      "p95": 2090.83,
      "max": 2090.83
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/interview-11 repeat 1](qwen/interview-11-r1/answer.txt): needs review
- [qwen/interview-01 repeat 1](qwen/interview-01-r1/answer.txt): needs review
- [qwen/interview-34 repeat 1](qwen/interview-34-r1/answer.txt): needs review
- [qwen/interview-24 repeat 1](qwen/interview-24-r1/answer.txt): needs review
- [qwen/unseen-arclight-02 repeat 1](qwen/unseen-arclight-02-r1/answer.txt): needs review
- [qwen/unseen-general-04 repeat 1](qwen/unseen-general-04-r1/answer.txt): passed
- [deepseek/interview-11 repeat 1](deepseek/interview-11-r1/answer.txt): passed
- [deepseek/interview-01 repeat 1](deepseek/interview-01-r1/answer.txt): passed
- [deepseek/interview-34 repeat 1](deepseek/interview-34-r1/answer.txt): passed
- [deepseek/interview-24 repeat 1](deepseek/interview-24-r1/answer.txt): passed
- [deepseek/unseen-general-04 repeat 1](deepseek/unseen-general-04-r1/answer.txt): passed
- [deepseek/unseen-arclight-02 repeat 1](deepseek/unseen-arclight-02-r1/answer.txt): passed