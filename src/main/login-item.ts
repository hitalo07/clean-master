import { app } from 'electron'

export interface LoginItemState {
  openAtLogin: boolean
  requiresApproval: boolean
}

// Lê se o app está registrado para abrir no login
export function getLoginItemState(): LoginItemState {
  const settings = app.getLoginItemSettings({ type: 'mainAppService' })
  return {
    openAtLogin: settings.openAtLogin,
    requiresApproval: settings.status === 'requires-approval'
  }
}

// Liga ou desliga a abertura no login do macOS
export function setOpenAtLogin(enabled: boolean): LoginItemState {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    type: 'mainAppService'
  })
  return getLoginItemState()
}
