'use strict';

// Electron display bounds use logical pixels, so OS DPI scaling is preserved.
function windowLayout(display) {
  const screenWidth = display.bounds.width;
  return {
    width: Math.round(screenWidth * 0.3),
    zoomFactor: Math.min(1.4, Math.max(0.85, screenWidth / 1920))
  };
}

module.exports = { windowLayout };
