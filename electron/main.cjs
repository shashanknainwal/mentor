// Mentor Desktop - Electron main process.
// Owns: the main window, system tray, global Spotlight shortcut, native dialogs,
// and the lifecycle of the Python engine.
const { app, BrowserWindow, Menu, Notification, Tray, dialog, globalShortcut, ipcMain, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { EngineProcess } = require('./engine.cjs');

const isDev = !!process.env.MENTOR_DEV;
const DEV_URL = process.env.MENTOR_DEV_URL || 'http://localhost:5173';
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, '..', 'assets', 'tray.png');

let mainWindow = null;
let spotlightWindow = null;
let tray = null;
let quitting = false;
let engineUrl = null;
const engineLog = [];

const engine = new EngineProcess(app, {
  onLog: (line) => {
    engineLog.push(line);
    if (engineLog.length > 500) engineLog.shift();
    if (isDev) process.stdout.write(`[engine] ${line}`);
  },
  onExit: (code) => {
    dialog.showErrorBox('Mentor engine stopped', `The Python engine exited (code ${code}). Use Diagnostics or restart Mentor.`);
  },
});

function loadRenderer(win, hash = '') {
  if (isDev) win.loadURL(`${DEV_URL}/${hash ? `#${hash}` : ''}`);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
}

async function readSettings() {
  try {
    const res = await fetch(`${engineUrl}/api/settings`);
    return await res.json();
  } catch {
    return {};
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: 'Mentor Desktop',
    icon: ICON,
    backgroundColor: '#0b1220',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loadRenderer(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', async (e) => {
    if (quitting) return;
    const s = await readSettings();
    if (s?.startup?.minimize_to_tray && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createSpotlight() {
  spotlightWindow = new BrowserWindow({
    width: 720,
    height: 460,
    frame: false,
    show: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: process.platform !== 'linux',
    backgroundColor: process.platform === 'linux' ? '#0f172a' : '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  loadRenderer(spotlightWindow, '/spotlight');
  spotlightWindow.on('blur', () => spotlightWindow?.hide());
}

function toggleSpotlight() {
  if (!spotlightWindow || spotlightWindow.isDestroyed()) createSpotlight();
  if (spotlightWindow.isVisible()) spotlightWindow.hide();
  else {
    spotlightWindow.center();
    spotlightWindow.show();
    spotlightWindow.focus();
    spotlightWindow.webContents.send('spotlight:open');
  }
}

function showMain(route) {
  if (!mainWindow) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
  if (route) mainWindow.webContents.send('navigate', route);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('Mentor Desktop');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Mentor', click: () => showMain() },
      { label: 'New chat', click: () => showMain('new-chat') },
      { label: 'Spotlight (Ctrl+Shift+Space)', click: toggleSpotlight },
      { type: 'separator' },
      { label: 'Dashboard', click: () => showMain('dashboard') },
      { label: 'Settings', click: () => showMain('settings') },
      { type: 'separator' },
      { label: 'Quit Mentor', click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', () => showMain());
}

function buildMenu() {
  // Deliberately no Ctrl+W/Ctrl+T/Ctrl+N accelerators: the renderer uses them for chat tabs.
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { label: 'Help', submenu: [{ label: 'Help Center', click: () => showMain('help') }, { label: 'Report Issue', click: () => showMain('report') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC (exposed to the renderer via preload.cjs)
// ---------------------------------------------------------------------------
ipcMain.handle('engine:url', () => engineUrl);
ipcMain.handle('engine:restart', async () => {
  engineUrl = await engine.restart();
  return engineUrl;
});
ipcMain.handle('engine:log', () => engineLog.join(''));
ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('dialog:pickFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  return res.canceled ? [] : res.filePaths;
});
ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
ipcMain.handle('notify', (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show();
});
ipcMain.handle('app:setLoginItem', (_e, enabled) => app.setLoginItemSettings({ openAtLogin: !!enabled }));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }));
ipcMain.handle('app:checkUpdates', async () => {
  // Wire electron-updater here once a release feed (e.g. internal S3/GitHub) is configured.
  return { current: app.getVersion(), update_available: false };
});
ipcMain.handle('spotlight:hide', () => spotlightWindow?.hide());
ipcMain.handle('spotlight:openChat', (_e, sessionId) => {
  spotlightWindow?.hide();
  showMain(`session:${sessionId}`);
});
ipcMain.handle('file:read', (_e, p) => {
  const buf = fs.readFileSync(p);
  return { name: path.basename(p), data: buf.toString('base64') };
});

// ---------------------------------------------------------------------------
app.setAppUserModelId('com.kpmg.mentor');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  app.whenReady().then(async () => {
    buildMenu();
    try {
      engineUrl = await engine.start();
    } catch (e) {
      dialog.showErrorBox(
        'Mentor engine failed to start',
        `${e.message}\n\nRun "npm run setup:engine" to create the Python environment, or set MENTOR_PYTHON.\n\n${engineLog.slice(-20).join('')}`,
      );
    }
    createMainWindow();
    createTray();
    if (!globalShortcut.register('CommandOrControl+Shift+Space', toggleSpotlight)) {
      console.warn('Could not register Spotlight shortcut');
    }
    const s = await readSettings();
    if (s?.startup) app.setLoginItemSettings({ openAtLogin: !!s.startup.launch_at_login });
  });

  app.on('before-quit', () => {
    quitting = true;
    engine.stop();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('activate', () => showMain());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) app.quit();
  });
}
