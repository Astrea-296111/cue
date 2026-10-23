'use strict';
const verify = require('./verify-semantic-packaging.cjs');
const writeBuildInfo = require('./write-build-info.cjs');
const path = require('node:path');
const { buildBundleFile } = require('./bundle-project-materials.cjs');
module.exports = async function prepareAppBuild(context) {
  await verify(context);
  const appDir = context.appDir || context.packager?.info?.appDir || context.packager?.appDir || process.cwd();
  await buildBundleFile({
    manifestPath: path.join(appDir, 'materials/manifest.json'),
    outputPath: path.join(appDir, 'materials/bundle.json'),
  });
  await writeBuildInfo(context);
};
