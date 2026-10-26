# CUE public multiturn evaluation

{
  "qwen": {
    "samples": 24,
    "passed": 24,
    "lengthPassed": 24,
    "semanticPassed": 24,
    "sourceFailures": 0,
    "preparationMs": {
      "count": 24,
      "p50": 13,
      "p95": 39.52,
      "max": 78.4
    },
    "firstSentenceMs": {
      "count": 24,
      "p50": 1618.14,
      "p95": 2694.79,
      "max": 5729.77
    },
    "doneMs": {
      "count": 24,
      "p50": 2904.03,
      "p95": 4210.42,
      "max": 6940.66
    },
    "over8s": 0
  },
  "deepseek": {
    "samples": 24,
    "passed": 23,
    "lengthPassed": 24,
    "semanticPassed": 24,
    "sourceFailures": 0,
    "preparationMs": {
      "count": 24,
      "p50": 10.17,
      "p95": 32.06,
      "max": 39.12
    },
    "firstSentenceMs": {
      "count": 24,
      "p50": 1258.83,
      "p95": 1828.89,
      "max": 1850.34
    },
    "doneMs": {
      "count": 24,
      "p50": 1650.91,
      "p95": 2162.21,
      "max": 3131.57
    },
    "over8s": 0
  }
}

Status: needs-review

Every case retains request.json, answer.txt, trace.json and judge.json. Failures are retained. No acoustic/Windows hardware latency is measured. Two repeats are not a confidence interval.

- [qwen/multi-2-1 repeat 1](qwen/multi-2-1-r1/answer.txt): passed
- [qwen/multi-1-1 repeat 1](qwen/multi-1-1-r1/answer.txt): passed
- [qwen/multi-1-2 repeat 1](qwen/multi-1-2-r1/answer.txt): passed
- [qwen/multi-2-2 repeat 1](qwen/multi-2-2-r1/answer.txt): passed
- [qwen/multi-3-1 repeat 1](qwen/multi-3-1-r1/answer.txt): passed
- [qwen/multi-4-1 repeat 1](qwen/multi-4-1-r1/answer.txt): passed
- [qwen/multi-3-2 repeat 1](qwen/multi-3-2-r1/answer.txt): passed
- [qwen/multi-4-2 repeat 1](qwen/multi-4-2-r1/answer.txt): passed
- [qwen/multi-5-1 repeat 1](qwen/multi-5-1-r1/answer.txt): passed
- [qwen/multi-6-1 repeat 1](qwen/multi-6-1-r1/answer.txt): passed
- [qwen/multi-5-2 repeat 1](qwen/multi-5-2-r1/answer.txt): passed
- [qwen/multi-6-2 repeat 1](qwen/multi-6-2-r1/answer.txt): passed
- [qwen/multi-7-1 repeat 1](qwen/multi-7-1-r1/answer.txt): passed
- [qwen/multi-8-1 repeat 1](qwen/multi-8-1-r1/answer.txt): passed
- [qwen/multi-7-2 repeat 1](qwen/multi-7-2-r1/answer.txt): passed
- [qwen/multi-8-2 repeat 1](qwen/multi-8-2-r1/answer.txt): passed
- [qwen/multi-10-1 repeat 1](qwen/multi-10-1-r1/answer.txt): passed
- [qwen/multi-9-1 repeat 1](qwen/multi-9-1-r1/answer.txt): passed
- [qwen/multi-10-2 repeat 1](qwen/multi-10-2-r1/answer.txt): passed
- [qwen/multi-9-2 repeat 1](qwen/multi-9-2-r1/answer.txt): passed
- [qwen/multi-12-1 repeat 1](qwen/multi-12-1-r1/answer.txt): passed
- [qwen/multi-11-1 repeat 1](qwen/multi-11-1-r1/answer.txt): passed
- [qwen/multi-12-2 repeat 1](qwen/multi-12-2-r1/answer.txt): passed
- [qwen/multi-11-2 repeat 1](qwen/multi-11-2-r1/answer.txt): passed
- [deepseek/multi-2-1 repeat 1](deepseek/multi-2-1-r1/answer.txt): passed
- [deepseek/multi-1-1 repeat 1](deepseek/multi-1-1-r1/answer.txt): passed
- [deepseek/multi-2-2 repeat 1](deepseek/multi-2-2-r1/answer.txt): passed
- [deepseek/multi-1-2 repeat 1](deepseek/multi-1-2-r1/answer.txt): passed
- [deepseek/multi-4-1 repeat 1](deepseek/multi-4-1-r1/answer.txt): passed
- [deepseek/multi-3-1 repeat 1](deepseek/multi-3-1-r1/answer.txt): passed
- [deepseek/multi-3-2 repeat 1](deepseek/multi-3-2-r1/answer.txt): passed
- [deepseek/multi-4-2 repeat 1](deepseek/multi-4-2-r1/answer.txt): passed
- [deepseek/multi-6-1 repeat 1](deepseek/multi-6-1-r1/answer.txt): passed
- [deepseek/multi-5-1 repeat 1](deepseek/multi-5-1-r1/answer.txt): passed
- [deepseek/multi-6-2 repeat 1](deepseek/multi-6-2-r1/answer.txt): passed
- [deepseek/multi-5-2 repeat 1](deepseek/multi-5-2-r1/answer.txt): passed
- [deepseek/multi-8-1 repeat 1](deepseek/multi-8-1-r1/answer.txt): passed
- [deepseek/multi-7-1 repeat 1](deepseek/multi-7-1-r1/answer.txt): passed
- [deepseek/multi-7-2 repeat 1](deepseek/multi-7-2-r1/answer.txt): passed
- [deepseek/multi-8-2 repeat 1](deepseek/multi-8-2-r1/answer.txt): passed
- [deepseek/multi-9-1 repeat 1](deepseek/multi-9-1-r1/answer.txt): passed
- [deepseek/multi-10-1 repeat 1](deepseek/multi-10-1-r1/answer.txt): passed
- [deepseek/multi-9-2 repeat 1](deepseek/multi-9-2-r1/answer.txt): passed
- [deepseek/multi-10-2 repeat 1](deepseek/multi-10-2-r1/answer.txt): passed
- [deepseek/multi-11-1 repeat 1](deepseek/multi-11-1-r1/answer.txt): needs review
- [deepseek/multi-12-1 repeat 1](deepseek/multi-12-1-r1/answer.txt): passed
- [deepseek/multi-11-2 repeat 1](deepseek/multi-11-2-r1/answer.txt): passed
- [deepseek/multi-12-2 repeat 1](deepseek/multi-12-2-r1/answer.txt): passed