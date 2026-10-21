'use strict';

const requestedSizes = new WeakMap();
const UI_SCALE = 1.25;

// Electron display bounds use logical pixels, so OS DPI scaling is preserved.
function windowLayout(display, height = 600) {
  const screenWidth = display.bounds.width;
  return {
    width: Math.round(Math.min(display.workArea.width / 2, screenWidth * 0.3) * UI_SCALE),
    // Give answers 20% more vertical space; stay within 75% of the work area.
    // Width and renderer zoom remain independent of this extra content space.
    height: Math.round(Math.min(display.workArea.height * 0.6, height * 1.2) * UI_SCALE),
    // Scale the entire renderer together: text, icons, controls and dialogs.
    zoomFactor: UI_SCALE * Math.min(1.4, Math.max(0.85, screenWidth / 1920))
  };
}

function initialWindowLayout(screen, settings = {}, height = 600) {
  const saved = Number.isFinite(settings.windowX) && Number.isFinite(settings.windowY);
  const display = saved
    ? screen.getDisplayNearestPoint({ x: settings.windowX, y: settings.windowY })
    : screen.getPrimaryDisplay();
  const layout = windowLayout(display, height);
  const area = display.workArea;
  const x = saved ? settings.windowX : Math.round(area.x + (area.width - layout.width) / 2);
  const y = saved ? settings.windowY : area.y + 6;
  return {
    ...layout, display,
    x: Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - layout.width))),
    y: Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - layout.height)))
  };
}

function moveWindow(win, x, y) {
  const size = requestedSizes.get(win);
  if (!size) return win.setPosition(x, y);
  // setPosition reads native bounds first. At fractional DPI those enclosing
  // bounds can be wider than requested, accumulating a pixel on every move.
  // Always carry the requested dimensions, never the rounded native size.
  win.setBounds({ x, y, ...size });
}

function attachWindowLayout(win, screen, initialDisplay, height = 600) {
  // Capture before destruction. BrowserWindow.webContents throws in 'closed'.
  const webContents = win.webContents;
  const signature = display => JSON.stringify([display.id, display.bounds.width,
    display.scaleFactor, display.workArea.x, display.workArea.y,
    display.workArea.width, display.workArea.height]);
  let applied = signature(initialDisplay);
  let applying = false;
  let detached = false;
  let timer = null;
  const initial = windowLayout(initialDisplay, height);
  const size = { width: initial.width, height: initial.height };
  requestedSizes.set(win, size);

  // A stable window origin owns the display. Using the entire window rectangle
  // makes display selection depend on the width that this controller changes.
  const currentDisplay = () => {
    const [x, y] = win.getPosition();
    return screen.getDisplayNearestPoint({ x, y });
  };
  const apply = (force = false) => {
    if (detached || applying || win.isDestroyed() || webContents.isDestroyed()) return;
    const display = currentDisplay();
    const nextSignature = signature(display);
    if (!force && applied === nextSignature) return;
    // Record before setBounds: Windows can emit moved synchronously on resize.
    applied = nextSignature;
    applying = true;
    try {
      const next = windowLayout(display, height);
      size.width = next.width;
      size.height = next.height;
      const [width, currentHeight] = win.getSize();
      // Fractional DPI can enclose native bounds by up to two logical pixels.
      if (Math.abs(width - next.width) > 2 || Math.abs(currentHeight - next.height) > 2) {
        const [x, y] = win.getPosition();
        const area = display.workArea;
        win.setBounds({
          x: Math.max(area.x, Math.min(x, area.x + area.width - size.width)),
          y: Math.max(area.y, Math.min(y, area.y + area.height - size.height)),
          ...size
        });
      }
      if (Math.abs(webContents.getZoomFactor() - next.zoomFactor) > 0.001) {
        webContents.setZoomFactor(next.zoomFactor);
      }
    } finally {
      applying = false;
    }
  };
  const moved = () => {
    if (detached || applying || win.isDestroyed()) return;
    clearTimeout(timer);
    timer = null;
    // Same-screen movement never writes dimensions, even if native DPI rounding
    // makes getSize() disagree with the requested size.
    if (signature(currentDisplay()) === applied) return;
    timer = setTimeout(() => { timer = null; apply(); }, 120);
  };
  const loaded = () => apply(true);
  const metrics = () => apply();
  const events = ['display-metrics-changed', 'display-added', 'display-removed'];
  const cleanup = () => {
    if (detached) return;
    detached = true;
    clearTimeout(timer);
    timer = null;
    win.removeListener('moved', moved);
    webContents.removeListener('did-finish-load', loaded);
    for (const event of events) screen.removeListener(event, metrics);
    win.removeListener('closed', cleanup);
    requestedSizes.delete(win);
  };
  win.on('moved', moved);
  webContents.on('did-finish-load', loaded);
  for (const event of events) screen.on(event, metrics);
  win.on('closed', cleanup);
  return cleanup;
}

module.exports = { UI_SCALE, windowLayout, initialWindowLayout, attachWindowLayout, moveWindow };
