import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { cleanCategories, CleanupError, parseCategoryIds, scanCategories } from './cleanup'

const FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

app.setName('Clean Master')

function getAppBundlePath(): string {
  return resolve(process.execPath, '..', '..', '..')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: 'Clean Master',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#0B0F14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('cleanup:scan', async () => {
    if (process.platform !== 'darwin') {
      throw new CleanupError('Este app funciona apenas no macOS')
    }

    try {
      return await scanCategories(homedir())
    } catch (error) {
      if (error instanceof CleanupError) {
        throw error
      }
      console.error('scan failed', { operation: 'scan' })
      throw new CleanupError('Não foi possível analisar os arquivos.')
    }
  })

  ipcMain.handle('cleanup:clean', async (_event, payload: unknown) => {
    if (process.platform !== 'darwin') {
      throw new CleanupError('Este app funciona apenas no macOS')
    }

    try {
      const categoryIds = parseCategoryIds(payload)
      return await cleanCategories(homedir(), categoryIds)
    } catch (error) {
      if (error instanceof CleanupError) {
        throw error
      }
      console.error('clean failed', { operation: 'clean' })
      throw new CleanupError('Não foi possível limpar os arquivos selecionados.')
    }
  })

  ipcMain.handle('system:openFullDiskAccess', async () => {
    try {
      const bundlePath = getAppBundlePath()
      clipboard.writeText(bundlePath)
      shell.showItemInFolder(bundlePath)
      await shell.openExternal(FULL_DISK_ACCESS_URL)
    } catch {
      throw new CleanupError('Não foi possível abrir os Ajustes do macOS.')
    }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
