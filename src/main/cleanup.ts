import { homedir } from 'node:os'
import { lstat, readdir, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  CATEGORY_IDS,
  CATEGORY_META,
  type CategoryId,
  type CategoryScan,
  type CleanResult,
  type ScanResult,
  isDeveloperArtifactName
} from '../shared/categories'
import { emptyTrashViaFinder, isAutomationDenied } from './finder-trash'

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
  overrides: Partial<Pick<CategoryScan, 'bytes' | 'exists' | 'permissionDenied' | 'unknownSize'>>
): CategoryScan {
  const meta = CATEGORY_META[id]
  return {
    id,
    label: meta.label,
    description: meta.description,
    bytes: 0,
    exists: true,
    permissionDenied: false,
    unknownSize: false,
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

async function collectDeveloperArtifacts(
  downloadsRoot: string
): Promise<Array<{ path: string; size: number }>> {
  const found: Array<{ path: string; size: number }> = []
  const stack = [downloadsRoot]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      break
    }

    let names: string[]
    try {
      names = await readdir(current)
    } catch (error) {
      if (isFsPermissionError(error) && path.resolve(current) === path.resolve(downloadsRoot)) {
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
        if (fileStat.isFile() && isDeveloperArtifactName(name)) {
          assertInsideAllowedRoot(downloadsRoot, fullPath)
          found.push({ path: fullPath, size: fileStat.size })
        }
      } catch {
        continue
      }
    }
  }

  return found
}

async function getDeveloperArtifactsSize(dirPath: string): Promise<number> {
  const files = await collectDeveloperArtifacts(dirPath)
  return files.reduce((sum, file) => sum + file.size, 0)
}

async function removeDeveloperArtifacts(homeDir: string, dirPath: string): Promise<number> {
  assertAllowedCategoryDir(homeDir, dirPath)
  const files = await collectDeveloperArtifacts(dirPath)
  let freed = 0
  let denied = 0

  for (const file of files) {
    try {
      assertInsideAllowedRoot(dirPath, file.path)
      if (!isDeveloperArtifactName(path.basename(file.path))) {
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

// Esvazia a pasta da categoria sem sair da lista branca
export async function emptyDirectory(homeDir: string, dirPath: string): Promise<void> {
  assertAllowedCategoryDir(homeDir, dirPath)
  if (path.resolve(dirPath) === resolveCategoryDir(homeDir, 'developerArtifacts')) {
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
    const dirPath = resolveCategoryDir(homeDir, id)
    const status = await inspectDirectory(dirPath)
    let bytes = 0
    let permissionDenied = status === 'denied' && id !== 'trash'
    let unknownSize = false
    const exists = status !== 'missing' || id === 'trash'

    if (status === 'ok') {
      try {
        bytes =
          id === 'developerArtifacts'
            ? await getDeveloperArtifactsSize(dirPath)
            : await getDirectorySize(dirPath)
      } catch (error) {
        if (error instanceof PermissionError && id === 'trash') {
          unknownSize = true
        } else if (error instanceof PermissionError) {
          permissionDenied = true
        } else {
          throw error
        }
      }
    } else if (id === 'trash' && status === 'denied') {
      unknownSize = true
    }

    categories.push(toCategoryScan(id, { bytes, exists, permissionDenied, unknownSize }))
  }

  return {
    categories,
    totalBytes: categories.reduce((sum, item) => sum + item.bytes, 0)
  }
}

// Remove o conteúdo das categorias selecionadas
export async function cleanCategories(
  homeDir: string,
  categoryIds: CategoryId[]
): Promise<CleanResult> {
  const categories = []

  for (const id of categoryIds) {
    const dirPath = resolveCategoryDir(homeDir, id)
    const status = await inspectDirectory(dirPath)

    if (id === 'trash' && status !== 'ok' && isRealUserHome(homeDir)) {
      try {
        await emptyTrashViaFinder()
        categories.push({ id, freedBytes: 0 })
        continue
      } catch (error) {
        if (isAutomationDenied(error) || isFsPermissionError(error)) {
          throw new PermissionError()
        }
        throw error
      }
    }

    if (status === 'denied') {
      throw new PermissionError()
    }

    if (id === 'developerArtifacts') {
      const freedBytes = status === 'ok' ? await removeDeveloperArtifacts(homeDir, dirPath) : 0
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
