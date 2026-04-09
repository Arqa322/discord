import { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, desktopCapturer } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPulseSignalingServer } from '../server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const iconPath = path.join(__dirname, '../public/pulsemesh-icon.png');

app.isQuiting = false;

let mainWindow = null;
let tray = null;
let signalingRuntime = null;

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b1020',
    title: 'PulseMesh Desktop',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon);
  tray.setToolTip('PulseMesh Desktop');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open PulseMesh',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      {
        label: 'Toggle Window',
        click: () => {
          if (!mainWindow) return;
          if (mainWindow.isVisible()) mainWindow.hide();
          else {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ]),
  );

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function setupIpc() {
  ipcMain.handle('desktop:get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('desktop:notify', (_event, title, body) => {
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: iconPath }).show();
    }
    return true;
  });

  ipcMain.handle('desktop:toggle-window', () => {
    if (!mainWindow) return false;
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
    return true;
  });

  ipcMain.handle('desktop:get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id,
      thumbnail: source.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle('desktop:get-signaling-url', () => signalingRuntime?.endpoint ?? 'http://127.0.0.1:3001');
}

async function startEmbeddedSignaling() {
  const dbFilePath = path.join(app.getPath('userData'), 'pulsemesh.db');
  const preferredPort = app.isPackaged ? 3001 : 3011;

  try {
    signalingRuntime = await startPulseSignalingServer({
      port: preferredPort,
      host: '127.0.0.1',
      dbFilePath,
      corsOrigin: '*',
    });
  } catch (_error) {
    // Fallback to dynamic port if preferred one is occupied.
    signalingRuntime = await startPulseSignalingServer({
      port: 0,
      host: '127.0.0.1',
      dbFilePath,
      corsOrigin: '*',
    });
  }
}

async function initAutoUpdates() {
  try {
    const electronUpdater = await import('electron-updater');
    const autoUpdater = electronUpdater.default?.autoUpdater ?? electronUpdater.autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.info('[PulseMesh] auto-updater is not active in this environment:', message);
  }
}

app.on('second-instance', () => {
  mainWindow?.show();
  mainWindow?.focus();
});

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    await startEmbeddedSignaling();
    setupIpc();
    await createMainWindow();
    createTray();
    await initAutoUpdates();
  });
}

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (signalingRuntime) {
    await signalingRuntime.stop();
    signalingRuntime = null;
  }
});
