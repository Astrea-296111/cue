# Runtime and deletion map

The production entry remains `package.json → src/custom-main.js → main.js`.
Startup is now explicit: `prepareOverlayIntegration()` attaches window observers,
root `main.js` registers the application, `activateOverlayControls()` installs
overlay interaction, and `installApplicationIntegration()` registers compatibility
imports and shortcuts. Provider creation and latency metrics belong to the
application/adapter; production no longer intercepts `Module._load`.
The entry obtains Electron's single-instance lock before constructing shared
settings/material services. Startup recovers an interrupted personal-workspace
transaction before installing a newer bundled material generation.

| Module | Responsibility |
| --- | --- |
| `src/custom-main.js` | Explicit bootstrap order |
| `src/overlay-interaction.js` | Pointer handling, drag and protected mouse passthrough |
| `src/application-integration.js` | Application shortcut/import compatibility |
| root `main.js` | Electron IPC, request lifecycle, audio and service coordination |
| `src/spoken-claim-ledger.js` | Versioned real dialogue, claims/corrections and separate suggestions |
| `src/conversation-memory.js` | Frozen request memory and project threads; previous AI text is not evidence |
| `src/project-entity-index.js` | Material-publication identifier/metric index; bounded local lookups |
| `src/personal-workspace*.js` | Validated v1/v2 compile, preview/commit, migration and separate job profiles |
| `src/project-material-service.js` | Atomic material authority and recovery |
| `src/instant-answer-context.js`, `src/final-request-budget.js` | Protected current question/speech and final model-window budget |
| `src/llm.js`, provider adapters | Streaming, real usage, abort and output ceilings |
| `src/window-protection.js`, `src/windows-capture-protection.js` | Display guards and native affinity verification |
| `renderer/personal-workspace.js` | Existing-window import, role/text correction and diagnostics controls |

No provider classification or judge call was inserted into foreground answers.
Evaluation actors/judges run only in offline tools. Code-output configuration is
a real application setting; the evaluator does not rewrite outgoing SDK bodies.

## Deletions and compatibility

| File | Evidence and action |
| --- | --- |
| `src/main.js` | Obsolete duplicate with broken `./src/...` relative imports; package entry, workflows, builder hooks and executable scripts do not load it. Deleted after repository-wide reference search. The test asserting it is never loaded remains. |
| `cue-settings-fix.patch` | Unreferenced historical patch, with no package/workflow/script consumer. Deleted; implemented behavior remains in actual modules. |
| `src/bugfix-main.js` | Kept as a small compatibility launcher for external users; production bootstrap uses explicit modules. |

Test harnesses may intercept module loading to isolate OS/network interfaces;
that mechanism is deliberately confined to tests. Historical benchmark documents
retain the entry chain used by their recorded commit. They are not rewritten to
claim a newer version was tested. Core routing/streaming/material, new migration,
dialogue, encrypted bridge and independent-judge regressions remain in the
explicit essential manifest; no per-helper test expansion is required.
