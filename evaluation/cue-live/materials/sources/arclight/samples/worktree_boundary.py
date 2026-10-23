"""SYNTHETIC CI REPRODUCTION, not upstream WorktreeManager.

This minimal example illustrates distinct session paths only. It executes no
Git command and provides no process sandbox, locking or shared-resource
isolation. See interview/worktree.md for the separately sourced public design.
"""
from pathlib import Path


def session_directory(repo_root, session_id):
    if not session_id or len(session_id) > 40 or not session_id.replace("-", "").isalnum():
        raise ValueError("a bounded session identifier is required")
    return Path(repo_root) / ".mewcode" / "worktrees" / session_id
