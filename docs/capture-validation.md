# Capture-protection validation

2026-10-26: the user explicitly waived the interactive Windows on-site check.
Physical microphone, system loopback, OBS/Tencent pixels and first-frame leakage
remain unverified. The waiver does not change the protection guards or the CI
native-affinity results below.

Protection is a release requirement. The production paths retain Electron
`setContentProtection(true)`, Windows Set/GetWindowDisplayAffinity with expected
`WDA_EXCLUDEFROMCAPTURE = 0x11`, hidden creation and protection before display.
Failures hide the window; restoration, focus/blur, resize, movement and mouse
passthrough recheck protection. No environment flag disables this behavior.

The overlay and permission window both use the existing protection helpers. New
personal import/preview, speech correction and errors are DOM inside the same
protected window. New job/speaker option lists also remain inside that window,
instead of relying on native popup handles with unverified affinity.

| Layer / path | Recorded scope |
| --- | --- |
| Core unit regression | Native failures hide/block display; every show/restore guards protection; invalid/destroyed handles rejected; passthrough rechecks; environment strings cannot disable protection |
| Actual Electron on Linux virtual X display | Hidden creation and protection request before show; real renderer/preload/IPC/material/profile flow. This is not Windows pixel exclusion |
| Windows CI `--native-only` | Actual Windows HWND and 0x11 native readback; Koffi load and Windows packaging. Run links/version are in the real evaluation report |
| Windows `desktopCapturer` pixels | Requires an interactive desktop; not established by native-only CI |
| OBS display capture | Not executed in this cloud environment |
| OBS window capture | Not executed in this cloud environment |
| Tencent Meeting / actual remote software | Not executed in this cloud environment |
| First-frame pixel leakage | Not established by Linux request-order assertions or native readback alone |
| macOS ScreenCaptureKit capture paths | Not executed; Electron documents capture-path limits |

## Reproduce on an interactive Windows desktop

Record Windows edition/build, Electron version, GPU, capture-software version and
capture mode. Run `npm run test:protection -- --native-only` first, then the
existing pixel smoke without that option. A native failure must stop release;
a success still needs pixel inspection.

Create a visible test pattern in the overlay; start capture before launching it
to examine the first display frame. Repeat hide/restore, focus change, movement,
resize, mouse passthrough, settings, personal preview and error states. Exercise
all self-created windows. Check captured frames for actual pattern/text rather
than interpreting the API return value as proof. Repeat independently for
desktopCapturer, OBS display/window modes, and the actual meeting/remote tool.

Keep images/video and an exact mode/version matrix privately if personal data
appears. Mark each path passed/failed/unverified. If a path exposes content,
record it as failed and keep the protection guard enabled while investigating.
Never add a screenshot-only bypass. The OS API cannot guarantee exclusion from
every capture technology; see [Microsoft's API boundary](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)
and [Electron documentation](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable).
