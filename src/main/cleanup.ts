import { homedir } from 'node:os'
import { lstat, readdir, realpath, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  CATEGORY_IDS,
  CATEGORY_META,
  type CategoryId,
  type CategoryScan,
  type CleanResult,
  type DownloadKind,
  type ScanResult,
  DOWNLOAD_KINDS,
  downloadKindOf,
  emptyKindBytes,
  isDiskImageName
} from '../shared/categories'
import {
  emptyTrashViaFinder,
  getTrashSizeViaFinder,
  isAutomationDenied,
  isTrashAlreadyEmpty,
  isTrashCanceled,
  pickTrashSize
} from './finder-trash'

export class CleanupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CleanupError'
  }
}

export class PermissionError extends CleanupError {
  constructor() {
    super('PERMISSION_DENIED')
    this.name = 'PermissionError'
  }
}

function getFsCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined
  }
  return (error as { code?: string }).code
}

export function isFsPermissionError(error: unknown): boolean {
  const code = getFsCode(error)
  return code === 'EACCES' || code === 'EPERM'
}

function isSkippableFsError(error: unknown): boolean {
  const code = getFsCode(error)
  return (
    isNotFoundError(error) ||
    code === 'EBUSY' ||
    code === 'ENOTEMPTY' ||
    code === 'EAGAIN' ||
    code === 'EIO' ||
    code === 'ENOTSUP' ||
    code === 'EROFS' ||
    code === 'ETXTBSY'
  )
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

// Valida os IDs recebidos do renderer contra a lista permitida
export function parseCategoryIds(input: unknown): CategoryId[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > CATEGORY_IDS.length) {
    throw new CleanupError('Seleção inválida')
  }

  const unique = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string' || !CATEGORY_IDS.includes(value as CategoryId)) {
      throw new CleanupError('Seleção inválida')
    }
    unique.add(value)
  }

  return [...unique] as CategoryId[]
}

export function parseDownloadsRelativePath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024) {
    throw new CleanupError('Seleção inválida')
  }
  const unix = input.replaceAll('\\', '/')
  if (unix.startsWith('/') || unix.includes('\0')) {
    throw new CleanupError('Seleção inválida')
  }
  const parts = unix.split('/').filter((part) => part.length > 0)
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new CleanupError('Seleção inválida')
  }
  return parts.join('/')
}

export function parseCleanRequest(input: unknown): {
  categoryIds: CategoryId[]
  downloadKinds: DownloadKind[]
  diskImages: string[]
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CleanupError('Seleção inválida')
  }
  const body = input as { categoryIds?: unknown; downloadKinds?: unknown; diskImages?: unknown }
  if (body.diskImages !== undefined && (!Array.isArray(body.diskImages) || body.diskImages.length > 300)) {
    throw new CleanupError('Seleção inválida')
  }
  const diskImages = Array.isArray(body.diskImages)
    ? [...new Set(body.diskImages.map((value) => parseDownloadsRelativePath(value)))]
    : []

  return {
    categoryIds: parseCategoryIds(body.categoryIds),
    downloadKinds: parseDownloadKinds(body.downloadKinds),
    diskImages
  }
}

export function parseDownloadKinds(input: unknown): DownloadKind[] {
  if (input === undefined) {
    return []
  }
  if (!Array.isArray(input) || input.length > DOWNLOAD_KINDS.length) {
    throw new CleanupError('Seleção inválida')
  }
  const unique = new Set<DownloadKind>()
  for (const value of input) {
    if (typeof value !== 'string' || !DOWNLOAD_KINDS.includes(value as DownloadKind)) {
      throw new CleanupError('Seleção inválida')
    }
    unique.add(value as DownloadKind)
  }
  return [...unique]
}

// Resolve a pasta da categoria e impede sair do diretório home
export function resolveCategoryDir(homeDir: string, categoryId: CategoryId): string {
  const home = path.resolve(homeDir)
  const target = path.resolve(home, CATEGORY_META[categoryId].relativePath)

  assertInsideAllowedRoot(home, target)
  if (target === home) {
    throw new CleanupError('Caminho fora da área permitida')
  }

  return target
}

async function resolveExistingCategoryDir(homeDir: string, categoryId: CategoryId): Promise<string> {
  const dirPath = resolveCategoryDir(homeDir, categoryId)
  try {
    return await realpath(dirPath)
  } catch {
    return dirPath
  }
}

export function assertInsideAllowedRoot(allowedRoot: string, candidate: string): void {
  const root = path.resolve(allowedRoot)
  const target = path.resolve(candidate)
  const relative = path.relative(root, target)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CleanupError('Caminho fora da área permitida')
  }
}

function isRealUserHome(homeDir: string): boolean {
  return path.resolve(homeDir) === path.resolve(homedir())
}

function toCategoryScan(
  id: CategoryId,
  overrides: Partial<Omit<CategoryScan, 'id' | 'label' | 'description'>>
): CategoryScan {
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
    files: [],
    ...overrides
  }
}

function assertAllowedCategoryDir(homeDir: string, dirPath: string): void {
  const resolved = path.resolve(dirPath)
  const allowed = CATEGORY_IDS.map((id) => resolveCategoryDir(homeDir, id))
  if (!allowed.includes(resolved)) {
    throw new CleanupError('Caminho fora da área permitida')
  }
}

// Distingue pasta ausente, acessível ou bloqueada pelo macOS
export async function inspectDirectory(dirPath: string): Promise<'missing' | 'ok' | 'denied'> {
  try {
    const stat = await lstat(dirPath)
    if (stat.isSymbolicLink()) {
      await readdir(dirPath)
      return 'ok'
    }
    if (!stat.isDirectory()) {
      return 'missing'
    }
    await readdir(dirPath)
    return 'ok'
  } catch (error) {
    if (isFsPermissionError(error)) {
      return 'denied'
    }
    if (isNotFoundError(error)) {
      return 'missing'
    }
    throw error
  }
}

// Soma o tamanho dos arquivos usando lstat — o tipo do readdir no macOS pode vir vazio
export async function getDirectorySize(dirPath: string): Promise<number> {
  const status = await inspectDirectory(dirPath)
  if (status !== 'ok') {
    return 0
  }

  let total = 0
  const stack = [dirPath]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      break
    }

    let names: string[]
    try {
      names = await readdir(current)
    } catch (error) {
      if (isFsPermissionError(error)) {
        throw new PermissionError()
      }
      continue
    }

    for (const name of names) {
      const fullPath = path.join(current, name)
      try {
        const fileStat = await lstat(fullPath)
        if (fileStat.isSymbolicLink()) {
          continue
        }
        if (fileStat.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        if (fileStat.isFile()) {
          total += fileStat.size
        }
      } catch {
        continue
      }
    }
  }

  return total
}

async function measureTrash(
  homeDir: string,
  dirPath: string,
  status: 'missing' | 'ok' | 'denied'
): Promise<{ bytes: number; unknownSize: boolean }> {
  if (status === 'ok') {
    try {
      return pickTrashSize(await getDirectorySize(dirPath), null)
    } catch (error) {
      if (!(error instanceof PermissionError)) {
        throw error
      }
      if (!isRealUserHome(homeDir)) {
        return pickTrashSize(null, null)
      }
    }
  }

  if (!isRealUserHome(homeDir)) {
    return pickTrashSize(null, status === 'denied' ? null : 0)
  }

  try {
    return pickTrashSize(null, await getTrashSizeViaFinder())
  } catch {
    return pickTrashSize(null, null)
  }
}

type DownloadsMatch = {
  path: string
  relativePath: string
  size: number
  kind: DownloadKind
}

function toDownloadsRelativePath(downloadsRoot: string, fullPath: string): string {
  return path.relative(downloadsRoot, fullPath).split(path.sep).join('/')
}

async function collectDownloadsMatches(downloadsRoot: string): Promise<DownloadsMatch[]> {
  const found: DownloadsMatch[] = []
  const stack = [downloadsRoot]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      break
    }

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (isFsPermissionError(error) && path.resolve(current) === path.resolve(downloadsRoot)) {
        throw new PermissionError()
      }
      continue
    }

    for (const entry of entries) {
      if (entry.name.startsWith('._')) {
        continue
      }
      const fullPath = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        const fileStat = await lstat(fullPath)
        if (fileStat.isSymbolicLink()) {
          continue
        }
        if (fileStat.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        if (!fileStat.isFile()) {
          continue
        }
        const kind = downloadKindOf(entry.name)
        if (!kind) {
          continue
        }
        assertInsideAllowedRoot(downloadsRoot, fullPath)
        found.push({
          path: fullPath,
          relativePath: toDownloadsRelativePath(downloadsRoot, fullPath),
          size: fileStat.size,
          kind
        })
      } catch {
        continue
      }
    }
  }

  return found
}

async function scanDownloads(dirPath: string): Promise<{
  bytes: number
  artifactBytes: number
  kindBytes: Record<DownloadKind, number>
  files: CategoryScan['files']
}> {
  const found = await collectDownloadsMatches(dirPath)
  const kindBytes = emptyKindBytes()
  for (const file of found) {
    kindBytes[file.kind] += file.size
  }
  const artifacts = found.filter((file) => file.kind !== 'dmg')
  const diskImages = found.filter((file) => file.kind === 'dmg')
  return {
    bytes: found.reduce((sum, file) => sum + file.size, 0),
    artifactBytes: artifacts.reduce((sum, file) => sum + file.size, 0),
    kindBytes,
    files: diskImages.map((file) => ({
      name: path.basename(file.path),
      relativePath: file.relativePath,
      bytes: file.size
    }))
  }
}

async function removeDeveloperArtifacts(
  homeDir: string,
  dirPath: string,
  kinds: DownloadKind[]
): Promise<number> {
  assertAllowedCategoryDir(homeDir, dirPath)
  const allowed = new Set<DownloadKind>(kinds.filter((kind) => kind !== 'dmg'))
  const files = (await collectDownloadsMatches(dirPath)).filter((file) => allowed.has(file.kind))
  let freed = 0
  let denied = 0

  for (const file of files) {
    try {
      assertInsideAllowedRoot(dirPath, file.path)
      if (downloadKindOf(path.basename(file.path)) !== file.kind) {
        continue
      }
      const fileStat = await lstat(file.path)
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        continue
      }
      await unlink(file.path)
      freed += file.size
    } catch (error) {
      if (isFsPermissionError(error)) {
        denied += 1
        continue
      }
      if (isSkippableFsError(error)) {
        continue
      }
      throw error
    }
  }

  if (freed === 0 && denied > 0) {
    throw new PermissionError()
  }

  return freed
}

async function removeDiskImages(
  homeDir: string,
  dirPath: string,
  relativePaths: string[]
): Promise<number> {
  assertAllowedCategoryDir(homeDir, dirPath)
  let freed = 0
  let denied = 0

  for (const relativePath of relativePaths) {
    const safeRelative = parseDownloadsRelativePath(relativePath)
    const fullPath = path.join(dirPath, ...safeRelative.split('/'))
    try {
      assertInsideAllowedRoot(dirPath, fullPath)
      if (!isDiskImageName(path.basename(fullPath))) {
        continue
      }
      const fileStat = await lstat(fullPath)
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        continue
      }
      await unlink(fullPath)
      freed += fileStat.size
    } catch (error) {
      if (error instanceof CleanupError && error.message === 'Seleção inválida') {
        continue
      }
      if (isFsPermissionError(error)) {
        denied += 1
        continue
      }
      if (isSkippableFsError(error)) {
        continue
      }
      throw error
    }
  }

  if (freed === 0 && denied > 0) {
    throw new PermissionError()
  }

  return freed
}

// Esvazia a pasta da categoria sem sair da lista branca
export async function emptyDirectory(homeDir: string, dirPath: string): Promise<void> {
  assertAllowedCategoryDir(homeDir, dirPath)
  if (path.resolve(dirPath) === resolveCategoryDir(homeDir, 'downloads')) {
    throw new CleanupError('Downloads não pode ser esvaziada')
  }

  const status = await inspectDirectory(dirPath)
  if (status === 'missing') {
    return
  }
  if (status === 'denied') {
    throw new PermissionError()
  }

  let names: string[]
  try {
    names = await readdir(dirPath)
  } catch (error) {
    if (isFsPermissionError(error)) {
      throw new PermissionError()
    }
    throw error
  }

  const results = await Promise.allSettled(
    names.map(async (name) => {
      const fullPath = path.join(dirPath, name)
      const entryStat = await lstat(fullPath)
      if (entryStat.isSymbolicLink()) {
        await unlink(fullPath)
        return
      }
      await rm(fullPath, { recursive: true, force: true })
    })
  )

  const permissionDenied = results.some(
    (result) => result.status === 'rejected' && isFsPermissionError(result.reason)
  )
  const unexpected = results.find(
    (result) =>
      result.status === 'rejected' &&
      !isFsPermissionError(result.reason) &&
      !isSkippableFsError(result.reason)
  )
  if (unexpected && unexpected.status === 'rejected') {
    throw unexpected.reason
  }
  if (permissionDenied && results.every((result) => result.status === 'rejected')) {
    throw new PermissionError()
  }
}

// Analisa o tamanho das pastas permitidas
export async function scanCategories(homeDir: string): Promise<ScanResult> {
  const categories = []

  for (const id of CATEGORY_IDS) {
    const dirPath = await resolveExistingCategoryDir(homeDir, id)
    const status = await inspectDirectory(dirPath)
    let bytes = 0
    let artifactBytes = 0
    let kindBytes = emptyKindBytes()
    let files: CategoryScan['files'] = []
    let permissionDenied = status === 'denied' && id !== 'trash'
    let unknownSize = false
    const exists = status !== 'missing' || id === 'trash'

    if (id === 'trash') {
      const trash = await measureTrash(homeDir, dirPath, status)
      bytes = trash.bytes
      unknownSize = trash.unknownSize
    } else if (status === 'ok') {
      try {
        if (id === 'downloads') {
          const downloads = await scanDownloads(dirPath)
          bytes = downloads.bytes
          artifactBytes = downloads.artifactBytes
          files = downloads.files
          kindBytes = downloads.kindBytes
        } else {
          bytes = await getDirectorySize(dirPath)
        }
      } catch (error) {
        if (error instanceof PermissionError) {
          permissionDenied = true
        } else {
          throw error
        }
      }
    }

    categories.push(
      toCategoryScan(id, { bytes, artifactBytes, kindBytes, exists, permissionDenied, unknownSize, files })
    )
  }

  return {
    categories,
    totalBytes: categories.reduce((sum, item) => sum + item.bytes, 0)
  }
}

// Remove o conteúdo das categorias selecionadas
export async function cleanCategories(
  homeDir: string,
  categoryIds: CategoryId[],
  options: { downloadKinds?: DownloadKind[]; diskImages?: string[] } = {}
): Promise<CleanResult> {
  const categories = []

  for (const id of categoryIds) {
    const dirPath = resolveCategoryDir(homeDir, id)
    const status = await inspectDirectory(dirPath)

    if (id === 'trash' && isRealUserHome(homeDir)) {
      const trash = await measureTrash(homeDir, dirPath, status)
      const freedBytes = trash.bytes
      try {
        await emptyTrashViaFinder()
        categories.push({ id, freedBytes })
        continue
      } catch (error) {
        if (isTrashAlreadyEmpty(error)) {
          categories.push({ id, freedBytes: 0 })
          continue
        }
        if (isTrashCanceled(error)) {
          throw new CleanupError('A exclusão da Lixeira foi cancelada no diálogo do macOS.')
        }
        if (isAutomationDenied(error) || isFsPermissionError(error)) {
          throw new PermissionError()
        }
        throw error
      }
    }

    if (status === 'denied') {
      throw new PermissionError()
    }

    if (id === 'downloads') {
      let freedBytes = 0
      if (status === 'ok') {
        const kinds = options.downloadKinds ?? ['ipa', 'apk', 'aab']
        const artifactKinds = kinds.filter((kind) => kind !== 'dmg')
        if (artifactKinds.length > 0) {
          freedBytes += await removeDeveloperArtifacts(homeDir, dirPath, artifactKinds)
        }
        if (kinds.includes('dmg') && options.diskImages && options.diskImages.length > 0) {
          freedBytes += await removeDiskImages(homeDir, dirPath, options.diskImages)
        }
      }
      categories.push({ id, freedBytes })
      continue
    }

    const freedBytes = status === 'ok' ? await getDirectorySize(dirPath) : 0
    await emptyDirectory(homeDir, dirPath)
    categories.push({ id, freedBytes })
  }

  return {
    categories,
    totalFreedBytes: categories.reduce((sum, item) => sum + item.freedBytes, 0)
  }
}
