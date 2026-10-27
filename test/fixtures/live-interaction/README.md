# Authored synthetic screen fixtures

Five 1400×820 PNGs are generated from authored English text and an IDE-like layout (files / task / chat or console), using Pillow and DejaVu Sans. They contain no original interview screenshot, personal data or project implementation facts.

- algorithm.png: sum an integer list, sample `[2,-1,5] → 6`, standalone Python and complexity; AI sidebar exists but collaboration is optional.
- vibe.png: collaborate with AI to build a read-only NL2SQL helper; propose design and prompts; schema/metric details are deliberately missing and must not be invented.
- sql.png: orders(id INTEGER PRIMARY KEY, amount REAL), request only a sum query.
- debug.png: uninitialized result in a Python loop, visible UnboundLocalError, ask for a minimal fix.
- unknown.png: empty editor, no task objective.

These fixtures exercise model routing, not OS screenshot capture or recovery of missing historical screenshots. The real SDK uses their actual PNG bytes; offline tests explicitly substitute OS/model transport.
