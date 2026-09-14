# Debug Session: ue-search-compact-crash

- **Status**: [OPEN]
- **Issue**: UE reportedly crashes frequently when searching in its dialogue editor while Shot Sandbox and compact mode are open.
- **Debug Server**: http://127.0.0.1:7777/event (local collector, PID 16988 at startup, 1200-second idle timeout).
- **Log File**: .dbg/trae-debug-log-ue-search-compact-crash.ndjson
- **Scope**: Inspect current code and existing crash evidence first. Preserve all pre-existing worktree changes. Do not modify business logic without runtime evidence.

## Reproduction Steps

1. Open UE and its dialogue editor.
2. Open Shot Sandbox and enable compact node-configuration mode.
3. Search in the UE dialogue editor.
4. User reports a frequent UE crash; exact search action and crash stack are not yet confirmed.

## Hypotheses & Verification

| ID | Hypothesis | Likelihood | Effort | Expected Signal / Evidence |
| --- | --- | --- | --- | --- |
| A | Selection polling dereferences stale editor or graph-node objects while search changes the graph. | High | Low | INCONCLUSIVE. Native editor/Slate failure confirmed, but no MCP/Python/reflection frames in the recorded stacks. All final logged calls returned before the fatal report. |
| B | Repeated reflection, asset loading, or queued UE requests overlaps search loading or garbage collection. | High | Medium | EXTRA WORK CONFIRMED; CAUSALITY INCONCLUSIVE. Final minute of the 18:56 crash contains 39 selection queries, 50 property reads, 8 subsystem lookups, 3 asset searches, and 3 text exports. |
| C | Selection changes automatically trigger camera or node asset mutations. | Medium | Low | NOT SUPPORTED for inspected paths/windows. Automatic selection paths read data; camera apply requires explicit confirmation. No mutation actions in the final-minute MCP action lists. |
| D | UE search crashes independently of compact-mode integration. | Medium | Medium | INCONCLUSIVE, with supporting counterevidence to an immediate collision. At 18:21, the final MCP response preceded the fatal report by 158.967 seconds. Earlier polling still occurred in that editor session, so this is not a clean control. |

## Instrumentation Plan

Only `server/ue/transport.ts` was changed in existing business code, with three temporary debug regions:

1. Request start: action, property name, selection-probe flag, connection port, pending count, trace ID.
2. Response: duration, success flag, specific empty-selection error flag.
3. Connection failure: pending count and bounded error message.

Logging is opt-in: `DEBUG_SESSION_ID=ue-search-compact-crash`. It uses `DEBUG_SERVER_URL` with a localhost fallback and a 750 ms reporting timeout. Reports are fire-and-forget and do not change UE request order, perform extra UE reads, log dialogue text/property values, or write assets. Existing packaged applications and development processes without these environment variables do not collect the new instrumentation.

## Log Evidence

All four logs below are in `<Seria project>/Saved/Logs/`. Times are quoted exactly as recorded in the UE logs. The crash reporter uses a different timestamp convention; do not compare its clock directly.

| UE log | Fatal report | Relevant evidence |
| --- | --- | --- |
| `Seria-backup-2026.09.11-10.44.09.log` | Line 883077: access violation at `0xffffffffffffffff` | Line 882954: `NoneType` selection error; lines 883049-883071: general graph fallback returns empty; lines 883079-883087: Slate / SeriaDialogEditor stack. Final MCP response is 15.077 seconds before fatal report. |
| `Seria-backup-2026.09.11-18.17.59.log` | Line 1301397: `SharedThis.Get() == this`, `SharedPointer.h:1329` | Line 1301271: `NoneType` selection error; line 1301381: completed fallback; line 1301388: first assertion-related output at 18:17:41.962, about 1.121 seconds after the response; lines 1301407-1301420: UnrealEd / SeriaDialogEditor / Slate. Fatal report itself is 17.191 seconds after the response. |
| `Seria-backup-2026.09.11-18.21.46.log` | Line 3366: access violation at `0xffffffffffffffff` | Last MCP response at line 3076, 18:19:07.462; lines 3368-3392: similar Slate / SeriaDialogEditor stack at 18:21:46.430. No MCP calls in the final 158.967 seconds before the fatal report. |
| `Seria-backup-2026.09.11-18.56.58.log` | Line 988407: access violation at `0x771` | Lines 988363-988400: selection probe returns successfully, local ID is still `"1"`; lines 988409-988432: Slate / SeriaDialogEditor stack. Last response is 5.121 seconds before fatal report. Final minute includes 103 MCP calls, all listed read/search/export actions. |

The historical summaries were submitted to the local collector for correlation. NDJSON lines 1-4 are initial summaries with invalid/null computed gaps; use verified v2 summaries at lines 11-14 instead. Lines 5-10 are mocked transport test events, NOT real UE requests. The original UE logs remain the primary evidence.

### Confirmed Client-Side Behavior

- `src/app/useUeDialogueSelection.ts:5-6,85-153`: polling starts at 1200 ms and only backs off repeated `offline` results. An individual effect waits for its response, but effect cleanup does not cancel an in-flight server/UE request.
- `src/App.tsx:2133-2135`: enablement depends on compact mode and workspace, not native search/editor-busy state.
- `server/ue/dialogueSelection.ts:13-14`: `list(get_current_selected_dialog_node_info())` raises `TypeError` when the helper returns `None`. This exact failure appears in multiple real logs.
- `server/ue/dialogueSelection.ts:519-530`: empty or failed helper results trigger a second, general graph-editor query. Catch-all fallback conflates unsupported APIs, temporary empty state, and transport errors.
- `server/ue/dialogueSelection.ts:137-180,492-517`: legacy local ID needs five additional round trips to reflect the real business ID. Those object references span requests; response-time throttling is not native editor lifetime protection.
- `src/App.tsx:2299-2382` and `server/ueBridge.ts:2655-2715`: a new selected node triggers configuration read; `configurationOnly` still exports the entire dialogue asset before selecting the target node. This can overlap selection polling through a separate connection.
- `src/components/NodeCameraQuickActions.tsx`: camera apply is an explicit action, not a selection-change effect.

### Native Evidence Limit

`SeriaDialogEditor` is installed as binaries without matching C++ sources or PDBs. The local `Saved/Crashes` directory is empty; CrashReportClient logs report the historical reports were discarded. The available stacks say `UnknownFunction`, so the exact search handler, widget, and invalid ownership transition cannot be proven here. The shared-pointer assertion is evidence of a native ownership invariant failure, not proof of a particular stale-node/GC mechanism.

## Verification Conclusion

No business fix applied and no live crash deliberately reproduced. A possible interaction is established at the request level, not causality. Do not call the issue fixed, claim that poll throttling will cure it, or dismiss a native editor defect.

- Passed 29 existing tests: `server/ue/transport.test.ts`, `server/ue/dialogueSelection.test.ts`, `src/app/useUeDialogueSelection.test.ts`.
- Passed `node node_modules/typescript/bin/tsc -b --pretty false`.
- Passed scoped `git diff --check`.
- No UE asset writes, plugin/DLL changes, package replacement, commits, pushes, or release operations.

## Safe Next Steps

First ask which exact search action triggers the crash: typing, submitting a query, or navigating to a result. Do not ask the user to intentionally crash an editor containing unsaved work.

For ordinary work, exit compact mode and allow ongoing reads to settle before searching. This removes recurring selection traffic but is a mitigation, not a guarantee.

For a controlled investigation after saving work, compare a fresh UE session with Shot Sandbox never opened against a session with compact mode enabled, using the same assets and operation. Do not infer independence from simply closing compact mode after earlier polling.

To collect instrumented development traffic, start a separate local dev server from this project, using a free port and the generated environment file:

```powershell
node --env-file=.dbg/ue-search-compact-crash.env node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4186 --strictPort
```

Before inviting a live run, check the debug collector health and clear only this session's NDJSON contents with `DELETE http://127.0.0.1:7777/logs`. The historical UE logs and this evidence table remain unchanged. Use `DEBUG_RUN_ID=pre-fix` until an evidence-backed fix exists. If the collector has idled out, restart the skill's existing `debug-server.py` with the same session and output directory.

The UE owner should preserve the next minidump/crash context and use matching symbols to inspect search callbacks, editor/tab lifetime, Slate shared-pointer ownership, selection clearing on editor destruction, and whether the selection helper/fallback can access or change editor focus during search. Search/GC/save-busy gating must happen before native object access; JavaScript `try/catch` cannot catch a C++ access violation.

Await explicit user verification or "abort debugging" before removing debug regions, collector, environment file, NDJSON, and this record. Current status remains [OPEN].
