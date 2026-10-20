'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

function verifySemanticPackaging(context) {
  const platform = context.electronPlatformName;
  const arch = typeof context.arch === 'string' ? context.arch : ARCH_NAMES[context.arch];
  if (!arch || arch === 'universal') return; // Electron Builder validates each constituent architecture.
  const appDir = context.appDir || context.packager?.info?.appDir || context.packager?.appDir;
  if (!appDir) throw new Error('无法确定本地语义检索的打包目录。');
  const modules = path.join(appDir, 'node_modules');
  const sharp = path.join(modules, '@img', `sharp-${platform}-${arch}`, 'lib', `sharp-${platform}-${arch}.node`);
  const ort = path.join(modules, 'onnxruntime-node', 'bin', 'napi-v3', platform, arch, 'onnxruntime_binding.node');
  const required = [sharp, ort];
  if (platform === 'win32') required.push(path.join(path.dirname(ort), 'onnxruntime.dll'),
    path.join(path.dirname(ort), 'DirectML.dll'), path.join(path.dirname(sharp), 'libvips-42.dll'),
    path.join(modules, '@koromix', `koffi-win32-${arch}`, `win32_${arch}`, 'koffi.node'));
  const missing = required.filter(file => !fs.existsSync(file));
  if (missing.length) throw new Error(`缺少 ${platform}/${arch} 的本地原生运行库，已停止打包。请在目标系统执行 npm ci；跨系统构建时须准备目标平台的 Sharp、ONNX 和 Koffi 依赖。缺少：${missing.join('、')}`);
}

module.exports = verifySemanticPackaging;
