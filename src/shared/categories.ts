export const CATEGORY_IDS = ['derivedData', 'archives', 'iosDeviceSupport', 'trash'] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

export const CATEGORY_META: Record<
  CategoryId,
  { label: string; description: string; relativePath: string }
> = {
  derivedData: {
    label: 'Derived Data',
    description: 'Builds temporários do Xcode',
    relativePath: 'Library/Developer/Xcode/DerivedData'
  },
  archives: {
    label: 'Archives',
    description: 'IPAs e apps arquivados pelo Xcode',
    relativePath: 'Library/Developer/Xcode/Archives'
  },
  iosDeviceSupport: {
    label: 'iOS Device Support',
    description: 'Símbolos de dispositivos iOS já conectados',
    relativePath: 'Library/Developer/Xcode/iOS DeviceSupport'
  },
  trash: {
    label: 'Lixeira',
    description: 'Arquivos já enviados para a Lixeira do macOS',
    relativePath: '.Trash'
  }
}

export interface CategoryScan {
  id: CategoryId
  label: string
  description: string
  bytes: number
  exists: boolean
  permissionDenied: boolean
  unknownSize: boolean
}

export interface ScanResult {
  categories: CategoryScan[]
  totalBytes: number
}

export interface CleanResult {
  categories: Array<{ id: CategoryId; freedBytes: number }>
  totalFreedBytes: number
}
