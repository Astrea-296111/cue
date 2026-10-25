'use strict';

// The package entry owns the order of application startup. Runtime module
// loading is never intercepted: provider creation and metrics stay in main/llm.
const overlay = require('./overlay-interaction');
const application = require('./application-integration');
const {app}=require('electron');

function bootstrapApplication() {
  // Acquire the user-data lock before root main constructs material/settings
  // services. A second Electron process must not publish into the same files.
  if(typeof app.requestSingleInstanceLock==='function'&&!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  overlay.prepareOverlayIntegration();
  require('../main.js');
  overlay.activateOverlayControls();
  application.installApplicationIntegration();
  return true;
}

bootstrapApplication();
module.exports = { ...application, bootstrapApplication };
