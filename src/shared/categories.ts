export const CATEGORY_IDS = [
  'derivedData',
  'archives',
  'iosDeviceSupport',
  'simulatorRuntime',
  'trash',
  'downloads'
] as const

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
  simulatorRuntime: {
    label: 'Simulator Runtime',
    description: 'Runtimes e dados do iPhone Simulator — não é Derived Data',
    relativePath: 'Library/Developer/CoreSimulator'
  },
  trash: {
    label: 'Lixeira',
    description: 'Arquivos já enviados para a Lixeira do macOS',
    relativePath: '.Trash'
  },
  downloads: {
    label: 'Downloads',
    description: 'Arquivos .ipa, .apk, .aab e .dmg na pasta Downloads',
    relativePath: 'Downloads'
  }
}

export interface CategoryFile {
  name: string
  relativePath: string
  bytes: number
}

export const DOWNLOAD_KINDS = ['ipa', 'apk', 'aab', 'dmg'] as const

export type DownloadKind = (typeof DOWNLOAD_KINDS)[number]

export interface CategoryScan {
  id: CategoryId
  label: string
  description: string
  bytes: number
  artifactBytes: number
  kindBytes: Record<DownloadKind, number>
  exists: boolean
  permissionDenied: boolean
  unknownSize: boolean
  files: CategoryFile[]
}

export interface ScanResult {
  categories: CategoryScan[]
  totalBytes: number
}

export interface CleanResult {
  categories: Array<{ id: CategoryId; freedBytes: number }>
  totalFreedBytes: number
}

export interface CleanRequest {
  categoryIds: CategoryId[]
  downloadKinds: DownloadKind[]
  diskImages: string[]
}

export function emptyKindBytes(): Record<DownloadKind, number> {
  return { ipa: 0, apk: 0, aab: 0, dmg: 0 }
}

export function downloadKindOf(fileName: string): DownloadKind | null {
  const lower = fileName.toLowerCase()
  for (const kind of DOWNLOAD_KINDS) {
    const ext = `.${kind}`
    if (lower.endsWith(ext) && lower.length > ext.length) {
      return kind
    }
  }
  return null
}

export function isDeveloperArtifactName(fileName: string): boolean {
  const kind = downloadKindOf(fileName)
  return kind === 'ipa' || kind === 'apk' || kind === 'aab'
}

export function isDiskImageName(fileName: string): boolean {
  return downloadKindOf(fileName) === 'dmg'
}

export function emptyCategoryScan(id: CategoryId): CategoryScan {
  const meta = CATEGORY_META[id]
  return {
    id,
    label: meta.label,
    description: meta.description,
    bytes: 0,
    artifactBytes: 0,
    kindBytes: emptyKindBytes(),
    exists: true,
    permissionDenied: false,
    unknownSize: false,
    files: []
  }
}
