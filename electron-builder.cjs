/* electron-builder configuration.
 *
 * Moved out of package.json so signing can be chosen by the environment rather
 * than hardcoded — the same shape NitroAI uses.
 *
 *   • Signed + notarized — set MAC_SIGN=1 with a "Developer ID Application"
 *     identity reachable in the keychain (or CSC_LINK in CI), plus
 *     APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID. electron-builder
 *     signs with the hardened runtime, notarizes, and staples. The app then
 *     opens on the first double-click with no warning at all.
 *
 *   • Ad-hoc fallback (no cert) — identity:null, so a fork or a secret-less CI
 *     run still produces a valid (not "damaged") build. It is NOT distributable:
 *     macOS refuses it after a download, and since macOS 15 the old
 *     right-click → Open escape hatch is gone.
 */

// Gated on an explicit flag rather than on CSC_LINK: a bare .p12 carries only
// the leaf certificate, and signing with an incomplete chain fails in a way
// that looks like a wrong password.
const hasCert = process.env.MAC_SIGN === "1";
const canNotarize =
  hasCert &&
  !!process.env.APPLE_ID &&
  !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  !!process.env.APPLE_TEAM_ID;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Preserve the identity and ASAR layout of the existing Windows builds.
  appId: "com.cue.assistant",
  productName: "Cue",
  asar: true,
  // The worker and native/runtime resources must resolve outside the ASAR.
  // Model weights stay in userData and are never bundled in regular installers.
  asarUnpack: [
    'node_modules/koffi/**/*',
    'node_modules/@koromix/**/*',
    'src/project-embedding-worker.cjs',
    'src/project-scope.js',
    'node_modules/@huggingface/**/*',
    'node_modules/onnxruntime-node/**/*',
    'node_modules/onnxruntime-common/**/*',
    'node_modules/onnxruntime-web/**/*',
    'node_modules/sharp/**/*',
    'node_modules/@img/**/*',
    'node_modules/detect-libc/**/*',
    'node_modules/semver/**/*',
  ],
  publish: null,
  beforePack: 'scripts/prepare-app-build.cjs',
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  // An allowlist, so anything new has to be added here or it simply is not in
  // the shipped app — and the only symptom is a require() that throws at
  // launch, in a build that ran fine from source.
  files: ["main.js", "preload.js", "src/**/*", "renderer/**/*", "vendor/**/*", "package.json", "build-info.json", "node_modules/**/*"],
  directories: { buildResources: "build-resources" },
  // The old effective package.json config did not run this hook. Keep default
  // builds independent of Whisper preparation; the existing opt-in remains.
  afterPack: process.env.CUE_BUNDLE_WHISPER ? "scripts/after-pack.js" : undefined,
  mac: {
    target: [{ target: "zip", arch: ["x64", "arm64"] }],
    category: "public.app-category.productivity",
    // With a real cert, let electron-builder discover it and apply the hardened
    // runtime (notarization is refused without it). Without one, identity:null
    // makes it skip signing rather than fail.
    identity: hasCert ? undefined : null,
    hardenedRuntime: hasCert,
    gatekeeperAssess: false,
    entitlements: "build-resources/entitlements.mac.plist",
    entitlementsInherit: "build-resources/entitlements.mac.plist",
    // electron-builder 26 wants a boolean; the credentials come from
    // APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in the env.
    notarize: canNotarize,
    extendInfo: {
      LSUIElement: true,
      NSMicrophoneUsageDescription:
        "cue transcribes your microphone so it can help you in conversations.",
      NSCameraUsageDescription: "cue does not use the camera.",
      NSAudioCaptureUsageDescription:
        "cue captures system audio to transcribe the other participant in a call.",
    },
  },
  win: {
    target: [{ target: "portable", arch: ["x64"] }],
    // Keep the existing prepared-runtime copy, without downloading or preparing.
    extraResources: [{
      from: ".cache/whisper-runtime/win32-x64",
      to: "whisper-runtime",
      filter: ["**/*"],
    }],
  },
  portable: {
    artifactName: "Cue-${version}-portable.${ext}",
  },
  // A per-user install with a visible directory step: cue is a personal overlay,
  // not a machine-wide service, so it should never need an elevation prompt.
  nsis: {
    artifactName: "Cue-${version}-setup.${ext}",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: "cue",
  },
  linux: {
    target: [{ target: "AppImage", arch: ["x64", "arm64"] }],
    category: "Utility",
  },
};
