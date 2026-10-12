'use strict';

const requestedSizes = new WeakMap();

// Electron display bounds use logical pixels, so OS DPI scaling is preserved.
function windowLayout(display) {
  const screenWidth = display.bounds.width;
  return {
    width: Math.round(screenWidth * 0.3),
    zoomFactor: Math.min(1.4, Math.max(0.85, screenWidth / 1920))
  };
}

function initialWindowLayout(screen, settings = {}, height = 600) {
  const saved = Number.isFinite(settings.windowX) && Number.isFinite(settings.windowY);
  const display = saved
    ? screen.getDisplayNearestPoint({ x: settings.windowX, y: settings.windowY })
    : screen.getPrimaryDisplay();
  const layout = windowLayout(display);
  const area = display.workArea;
  const x = saved ? settings.windowX : Math.round(area.x + (area.width - layout.width) / 2);
  const y = saved ? settings.windowY : area.y + 6;
  return {
    ...layout, display,
    x: Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - layout.width))),
    y: Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - height)))
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
  const signature = display => JSON.stringify([display.id, display.bounds.width, display.scaleFactor]);
  let applied = signature(initialDisplay);
  let applying = false;
  let timer = null;
  const size = { width: windowLayout(initialDisplay).width, height };
  requestedSizes.set(win, size);

  // A stable window origin owns the display. Using the entire window rectangle
  // makes display selection depend on the width that this controller changes.
  const currentDisplay = () => {
    const [x, y] = win.getPosition();
    return screen.getDisplayNearestPoint({ x, y });
  };
  const apply = (force = false) => {
    if (applying || win.isDestroyed()) return;
    const display = currentDisplay();
    const nextSignature = signature(display);
    if (!force && applied === nextSignature) return;
    // Record before setBounds: Windows can emit moved synchronously on resize.
    applied = nextSignature;
    applying = true;
    try {
      const next = windowLayout(display);
      size.width = next.width;
      const [width] = win.getSize();
      // Fractional DPI can enclose native bounds by up to two logical pixels.
      if (Math.abs(width - next.width) > 2) {
        const [x, y] = win.getPosition();
        win.setBounds({ x, y, ...size });
      }
      if (Math.abs(win.webContents.getZoomFactor() - next.zoomFactor) > 0.001) {
        win.webContents.setZoomFactor(next.zoomFactor);
      }
    } finally {
      applying = false;
    }
  };
  const moved = () => {
    if (applying || win.isDestroyed()) return;
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
    clearTimeout(timer);
    win.removeListener('moved', moved);
    win.webContents.removeListener('did-finish-load', loaded);
    for (const event of events) screen.removeListener(event, metrics);
    win.removeListener('closed', cleanup);
    requestedSizes.delete(win);
  };
  win.on('moved', moved);
  win.webContents.on('did-finish-load', loaded);
  for (const event of events) screen.on(event, metrics);
  win.on('closed', cleanup);
  return cleanup;
}

module.exports = { windowLayout, initialWindowLayout, attachWindowLayout, moveWindow };
