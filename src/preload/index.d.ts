import type { CleanRequest, CleanResult, ScanResult } from '../shared/categories'

export interface LoginItemState {
  openAtLogin: boolean
  requiresApproval: boolean
}

export interface CleanMasterAPI {
  isPackaged: () => Promise<boolean>
  scan: () => Promise<ScanResult>
  clean: (payload: CleanRequest) => Promise<CleanResult>
  openFullDiskAccess: () => Promise<void>
  getOpenAtLogin: () => Promise<LoginItemState>
  setOpenAtLogin: (enabled: boolean) => Promise<LoginItemState>
  openLoginItemsSettings: () => Promise<void>
  requestDownloadsAccess: () => Promise<{ granted: boolean }>
}

declare global {
  interface Window {
    cleanMaster: CleanMasterAPI
  }
}

export {}
