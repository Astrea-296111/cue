"""SYNTHETIC CI REPRODUCTION, not the upstream Arclight implementation.

This small example makes interrupted tool-call pairing searchable in CI. It is
not a complete conversation parser, persistence layer or process sandbox.
"""
from copy import deepcopy


def pair_pending_calls(messages, pending_call_ids):
    forked = deepcopy(messages)
    completed = {m.get("tool_call_id") for m in forked if m.get("role") == "tool"}
    for call_id in pending_call_ids:
        if call_id not in completed:
            forked.append({"role": "tool", "tool_call_id": call_id, "content": "interrupted"})
    return forked
