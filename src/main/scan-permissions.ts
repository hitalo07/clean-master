import { clipboard, dialog, app, type BrowserWindow, shell } from 'electron'
import { join, resolve, basename } from 'node:path'
import { readdir, realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { inspectDirectory } from './cleanup'

const execFileAsync = promisify(execFile)

const FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
const FILES_AND_FOLDERS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'

const PROTECTED_RELATIVE_PATHS = [
  '.Trash',
  'Library/Developer/Xcode/DerivedData',
  'Library/Developer/Xcode/Archives',
  'Library/Developer/Xcode/iOS DeviceSupport',
  'Library/Developer/CoreSimulator'
]

export async function needsDownloadsPrompt(homeDir: string): Promise<boolean> {
  const downloads = resolve(homeDir, 'Downloads')
  const status = await inspectDirectory(downloads)
  if (status !== 'ok') {
    return status === 'denied'
  }
  try {
    const names = await readdir(downloads)
    return names.length === 0
  } catch {
    return true
  }
}

export async function needsFullDiskAccess(homeDir: string): Promise<boolean> {
  for (const relativePath of PROTECTED_RELATIVE_PATHS) {
    const status = await inspectDirectory(resolve(homeDir, relativePath))
    if (status === 'denied') {
      return true
    }
  }
  return false
}

export async function isSameDownloadsFolder(
  selectedPath: string,
  downloadsPath: string
): Promise<boolean> {
  if (basename(selectedPath).toLowerCase() !== 'downloads') {
    return false
  }
  const selected = resolve(selectedPath)
  const downloads = resolve(downloadsPath)
  if (selected === downloads) {
    return true
  }
  try {
    return (await realpath(selected)) === (await realpath(downloads))
  } catch {
    return false
  }
}

export function resolveFinderAutomationHelper(
  isPackaged: boolean,
  resourcesPath: string,
  moduleDir: string
): string {
  if (isPackaged) {
    return join(resourcesPath, 'ask-finder-automation')
  }
  return join(moduleDir, '../../build/ask-finder-automation')
}

// Pede ao processo do app (não ao osascript) o diálogo de Automação do Finder
export async function requestTrashAutomation(): Promise<boolean> {
  const helper = resolveFinderAutomationHelper(app.isPackaged, process.resourcesPath, __dirname)
  try {
    await execFileAsync(helper, [], { timeout: 120_000 })
    return true
  } catch {
    return false
  }
}

export async function requestDownloadsAccess(
  homeDir: string,
  window: BrowserWindow | null
): Promise<boolean> {
  const downloads = resolve(homeDir, 'Downloads')
  const dialogOptions = {
    title: 'Permitir acesso a Downloads',
    message: 'Selecione a pasta Downloads para o Clean Master analisar .ipa, .apk, .aab e .dmg.',
    defaultPath: downloads,
    buttonLabel: 'Permitir',
    properties: ['openDirectory' as const]
  }
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return false
  }
  if (!(await isSameDownloadsFolder(result.filePaths[0], downloads))) {
    return false
  }

  const grantedPath = result.filePaths[0]
  const status = await inspectDirectory(grantedPath)
  if (status === 'denied') {
    await shell.openExternal(FILES_AND_FOLDERS_URL)
    return false
  }
  return status !== 'missing'
}

export async function openFullDiskAccessHelp(): Promise<void> {
  const bundlePath = resolve(process.execPath, '..', '..', '..')
  clipboard.writeText(bundlePath)
  shell.showItemInFolder(bundlePath)
  await shell.openExternal(FULL_DISK_ACCESS_URL)
}

// Pede Lixeira, Downloads e disco antes de varrer. Se recusar, a próxima análise pede de novo.
export async function ensureScanPermissions(
  homeDir: string,
  window: BrowserWindow | null
): Promise<void> {
  await requestDownloadsAccess(homeDir, window)
  await requestTrashAutomation()

  if (await needsFullDiskAccess(homeDir)) {
    await openFullDiskAccessHelp()
  }
}
