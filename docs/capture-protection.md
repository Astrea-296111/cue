# 窗口录屏保护的范围与验证

核对 `Astrea-296111/cue` 的 `32a85e6` 及相关历史，实际入口为 `src/custom-main.js → src/bugfix-main.js → main.js`，近期迭代没有删除 `setContentProtection(true)`。旧版曾允许 `CUE_NO_PROTECT` 跳过保护，这一开关已在之前的修复中取消。仅凭当前仓库无法确认用户电脑上哪一个旧安装版本开始失效。

Electron 33.2.1 的 [Windows 实现](https://github.com/electron/electron/blob/v33.2.1/shell/browser/native_window_views.cc) 忽略 `SetWindowDisplayAffinity` 的返回值；调用未抛异常不能说明 Windows 接受了排除请求。本次补上原生验证：

- 主窗口和 Cue 自身的权限引导窗口以隐藏状态创建，在显示前请求保护；Ctrl+P 恢复和应用内授权提示也复用同一请求流程。
- 在 Electron 请求保护后，用 Koffi 在同一进程中对实际 HWND 调用 `SetWindowDisplayAffinity(0x11)`，并用 `GetWindowDisplayAffinity` 回读，必须得到 `WDA_EXCLUDEFROMCAPTURE`。不会把 `isContentProtected()` 的缓存状态当作原生验证结果。
- 鼠标穿透会修改 Windows 原生窗口样式，修改后重新设置并验证保护；窗口显示、恢复、焦点和尺寸变化后也会复核。
- 原生调用失败、回读不一致、缺少原生模块或系统过旧时，隐藏窗口、阻止显示并在日志中记录原因；不会把 `WDA_MONITOR` 的黑色区域当作完整排除。原有鼠标、拖动和键盘功能保留。
- 打包时解包 Koffi 原生模块，并检查目标 Windows 架构的模块是否存在，缺少时停止打包。

回读 `0x11` 证明 Windows 保存了该窗口的捕获排除标志，不能证明每一种捕获路径都遵守它。

## 平台限制

Windows 10 内部版本 19041 起支持完整窗口排除；本次 Windows 原生保护要求这一最低版本。旧系统无法满足此要求时保持 Cue 窗口隐藏。macOS 保留 Electron 的窗口共享限制，但 ScreenCaptureKit 可能仍能捕获；Linux 没有此接口提供的内容保护保证。

显示器、窗口、游戏、显卡驱动等捕获方式可能使用不同路径。微软明确说明 [SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity) 不提供对所有捕获方式的严格保护。UU 等远程软件的驱动捕获路径、RDP 会话和会议软件的实际捕获模式需要分别验证；不能保证远程画面一定不含窗口。本次不修改操作系统权限、录屏软件或进程身份。

## 自动验证

在仓库目录执行：

```sh
node --test test/window-protection.test.js test/windows-capture-protection.test.js test/semantic-packaging.test.js
```

Windows 10 19041+ / Windows 11 桌面上执行：

```sh
npm ci
npm run test:protection
```

Windows smoke 会显示无用户内容的绿色背景和品红测试窗口，先确认未保护的品红窗口能被桌面捕获，再确认启用保护、切换鼠标穿透、隐藏恢复和移动后，捕获结果露出绿色背景，本地窗口仍可见。成功输出 `CAPTURE_PROTECTION_OK`，不会将屏幕截图写入文件。它验证 Electron 的屏幕捕获路径，不能代替腾讯会议或 UU 的实测。

Windows CI 使用 `npm run test:protection -- --native-only`，验证真实 HWND、回读标志、鼠标穿透和恢复流程，输出 `desktopCaptureVerified: false`。这一模式不声称验证了像素捕获结果。

## 实机验收

用户确认场景为 Windows 10/11、腾讯会议共享整个屏幕或 UU 远程。当前 Linux 云端未在这两款软件上完成实机捕获验证，新增 Windows smoke 的原生及像素结果也须在 Windows 上执行后确认。

请记录 Windows `winver` 的内部版本号、Cue 版本、录屏软件版本及捕获模式，然后用无敏感信息的测试内容验证：

1. 分别测试软件提供的显示器捕获、窗口捕获等实际使用的模式。
2. 检查启动、Ctrl+P 隐藏/恢复、方向键移动及拖动后的录制结果。
3. 检查 Cue 主界面、设置和其他 Cue 自身窗口；操作系统自己的授权或文件选择对话框由操作系统管理，不能据此推断 Cue 主窗口的保护状态。
4. 若仍能录到，保留上述版本及模式信息及 `test:protection` 的结果，区分原生排除失败与捕获软件不遵守排除。更新后的源码必须重新打包、安装，已安装的旧 EXE 不会因合并代码而自动变化。未完成实机验收前不能宣称“任何录屏都不可见”。

自动测试覆盖开关策略、保护请求与显示顺序、请求异常、关闭及恢复；Linux 云端的 Electron 界面测试不能代替真实 Windows 录屏验收。
