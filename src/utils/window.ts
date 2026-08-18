export { isWindowAlive, getWin, getDoc };

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

/** The active Zotero main window (may be null when all main windows are closed). */
function getWin(): _ZoteroTypes.MainWindow {
  return Zotero.getMainWindow();
}

function getDoc(): Document {
  return getWin().document;
}
