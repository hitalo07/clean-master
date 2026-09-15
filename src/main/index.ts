import { app, BrowserWindow, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cleanCategories, CleanupError, parseCleanRequest, scanCategories } from './cleanup'
import { getLoginItemState, openLoginItemsSettings, setOpenAtLogin } from './login-item'
import {
  ensureScanPermissions,
  openFullDiskAccessHelp,
  requestDownloadsAccess
} from './scan-permissions'
import { createTray, refreshTrayMenu } from './tray'
import { parseEnabledFlag } from '../shared/flags'

app.setName('Clean Master')

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
      await ensureScanPermissions(homedir(), mainWindow)
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
      const request = parseCleanRequest(payload)
      return await cleanCategories(homedir(), request.categoryIds, {
        downloadKinds: request.downloadKinds,
        diskImages: request.diskImages
      })
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
      await openFullDiskAccessHelp()
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
      if (enabled) {
        await openLoginItemsSettings()
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
    const granted = await requestDownloadsAccess(homedir(), mainWindow)
    return { granted }
  })

  ipcMain.handle('system:openLoginItemsSettings', async () => {
    try {
      await openLoginItemsSettings()
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
