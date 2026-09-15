import type { CategoryId, CleanResult, ScanResult } from '../shared/categories'

export interface LoginItemState {
  openAtLogin: boolean
  requiresApproval: boolean
}

export interface CleanMasterAPI {
  scan: () => Promise<ScanResult>
  clean: (categoryIds: CategoryId[]) => Promise<CleanResult>
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
