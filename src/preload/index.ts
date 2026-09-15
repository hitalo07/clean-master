import { contextBridge, ipcRenderer } from 'electron'
import type { CategoryId, CleanResult, ScanResult } from '../shared/categories'

export interface LoginItemState {
  openAtLogin: boolean
  requiresApproval: boolean
}

const cleanMaster = {
  scan: (): Promise<ScanResult> => ipcRenderer.invoke('cleanup:scan'),
  clean: (categoryIds: CategoryId[]): Promise<CleanResult> =>
    ipcRenderer.invoke('cleanup:clean', categoryIds),
  openFullDiskAccess: (): Promise<void> => ipcRenderer.invoke('system:openFullDiskAccess'),
  getOpenAtLogin: (): Promise<LoginItemState> => ipcRenderer.invoke('system:getOpenAtLogin'),
  setOpenAtLogin: (enabled: boolean): Promise<LoginItemState> =>
    ipcRenderer.invoke('system:setOpenAtLogin', enabled),
  openLoginItemsSettings: (): Promise<void> => ipcRenderer.invoke('system:openLoginItemsSettings'),
  requestDownloadsAccess: (): Promise<{ granted: boolean }> =>
    ipcRenderer.invoke('system:requestDownloadsAccess')
}

contextBridge.exposeInMainWorld('cleanMaster', cleanMaster)
