import type { CategoryId, CleanResult, ScanResult } from '../shared/categories'

export interface CleanMasterAPI {
  scan: () => Promise<ScanResult>
  clean: (categoryIds: CategoryId[]) => Promise<CleanResult>
  openFullDiskAccess: () => Promise<void>
}

declare global {
  interface Window {
    cleanMaster: CleanMasterAPI
  }
}

export {}
