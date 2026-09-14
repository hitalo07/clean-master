import { contextBridge, ipcRenderer } from 'electron'
import type { CategoryId, CleanResult, ScanResult } from '../shared/categories'

const cleanMaster = {
  scan: (): Promise<ScanResult> => ipcRenderer.invoke('cleanup:scan'),
  clean: (categoryIds: CategoryId[]): Promise<CleanResult> =>
    ipcRenderer.invoke('cleanup:clean', categoryIds),
  openFullDiskAccess: (): Promise<void> => ipcRenderer.invoke('system:openFullDiskAccess')
}

contextBridge.exposeInMainWorld('cleanMaster', cleanMaster)
