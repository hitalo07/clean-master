import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { getLoginItemState, setOpenAtLogin } from './login-item'

let tray: Tray | null = null

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../build/tray.png')
}

// Cria o ícone da barra de menus do macOS
export function createTray(showWindow: () => void): void {
  if (tray) {
    return
  }

  const icon = nativeImage.createFromPath(trayIconPath()).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip('Clean Master')
  tray.on('click', () => showWindow())
  refreshTrayMenu(showWindow)
}

export function refreshTrayMenu(showWindow: () => void): void {
  if (!tray) {
    return
  }

  const login = getLoginItemState()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Clean Master', click: () => showWindow() },
      {
        label: 'Abrir ao iniciar o Mac',
        type: 'checkbox',
        checked: login.openAtLogin,
        click: (item) => {
          setOpenAtLogin(item.checked)
          refreshTrayMenu(showWindow)
        }
      },
      { type: 'separator' },
      { label: 'Sair', role: 'quit' }
    ])
  )
}
