'use strict';
const verify = require('./verify-semantic-packaging.cjs');
const writeBuildInfo = require('./write-build-info.cjs');
module.exports = async function prepareAppBuild(context) {
  await verify(context);
  await writeBuildInfo(context);
};
