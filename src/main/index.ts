import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readdir } from 'node:fs/promises'
import {
  cleanCategories,
  CleanupError,
  isFsPermissionError,
  parseCategoryIds,
  scanCategories
} from './cleanup'
import { getLoginItemState, setOpenAtLogin } from './login-item'
import { createTray, refreshTrayMenu } from './tray'
import { parseEnabledFlag } from '../shared/flags'

const FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
const LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
const FILES_AND_FOLDERS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'

app.setName('Clean Master')

function getAppBundlePath(): string {
  return resolve(process.execPath, '..', '..', '..')
}

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: 'Clean Master',
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
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

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
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
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : undefined
      console.error('clean failed', { operation: 'clean', code })
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

  ipcMain.handle('system:isPackaged', () => app.isPackaged)

  ipcMain.handle('system:getOpenAtLogin', () => getLoginItemState())

  ipcMain.handle('system:setOpenAtLogin', async (_event, payload: unknown) => {
    try {
      const enabled = parseEnabledFlag(payload)
      const state = setOpenAtLogin(enabled)
      refreshTrayMenu(showWindow)
      if (enabled && state.requiresApproval) {
        await shell.openExternal(LOGIN_ITEMS_URL)
      }
      return state
    } catch (error) {
      if (error instanceof CleanupError || (error instanceof Error && error.message === 'Seleção inválida')) {
        throw new CleanupError('Seleção inválida')
      }
      throw new CleanupError('Não foi possível alterar o início automático.')
    }
  })

  ipcMain.handle('system:requestDownloadsAccess', async () => {
    const downloads = resolve(homedir(), 'Downloads')
    const dialogOptions = {
      title: 'Permitir acesso a Downloads',
      message: 'Selecione a pasta Downloads para limpar arquivos .ipa, .apk e .aab.',
      defaultPath: downloads,
      buttonLabel: 'Permitir',
      properties: ['openDirectory' as const]
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return { granted: false }
    }

    if (resolve(result.filePaths[0]) !== downloads) {
      throw new CleanupError('Selecione a pasta Downloads')
    }

    try {
      await readdir(downloads)
      return { granted: true }
    } catch (error) {
      if (isFsPermissionError(error)) {
        await shell.openExternal(FILES_AND_FOLDERS_URL)
        return { granted: false }
      }
      throw new CleanupError('Não foi possível acessar a pasta Downloads.')
    }
  })

  ipcMain.handle('system:openLoginItemsSettings', async () => {
    try {
      await shell.openExternal(LOGIN_ITEMS_URL)
    } catch {
      throw new CleanupError('Não foi possível abrir os Ajustes do macOS.')
    }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  createTray(showWindow)

  app.on('activate', () => {
    showWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
