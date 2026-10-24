# 打包 Cue

`electron-builder.cjs` 是唯一打包配置。`package.json` 只保留启动、测试和打包命令，不再放置 `build` 配置。

使用 Node.js 22.12 或更新版本，先执行 `npm ci` 安装锁文件中的依赖。

| 命令 | 产物 |
| --- | --- |
| `npm run pack:win` | Windows x64 目录包，位于 `dist/win-unpacked` |
| `npm run dist:win` | `dist/Cue-<版本>-portable.exe` |
| `npm run dist:win:installer` | `dist/Cue-<版本>-setup.exe` |
| `npm run dist` | macOS zip，沿用配置中的签名与公证条件 |
| `npm run dist:linux` | Linux x64 AppImage |
| `npm run dist:linux:arm64` | Linux arm64 AppImage |

Windows 沿用 `com.cue.assistant`、`Cue` 和 ASAR 布局。目录包需整体分发，包括 `resources/app.asar` 及其配套的 `app.asar.unpacked` 目录。配置中的 `publish: null` 保持打包与发布分开。

普通打包不新增 Whisper 准备或下载步骤。已准备的 Windows 运行时仍可从原 `.cache/whisper-runtime/win32-x64` 路径复制；已有 Whisper 功能代码不变。原有 `CUE_BUNDLE_WHISPER` 显式开关才启用 `afterPack` 中的准备运行时检查。

`npm test` 只运行明确保留的关键回归，清单与取舍见[关键回归说明](essential-testing.md)。Windows 打包和原生捕获保护由 CI 单独验证：

```sh
npm test
```
