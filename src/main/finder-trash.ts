import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function parseFinderSize(stdout: string): number {
  const value = Number(stdout.trim())
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function isAutomationDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('-1743') ||
    message.includes('not allowed assistive') ||
    message.includes('Not authorised') ||
    message.includes('Not authorized') ||
    message.includes('not allowed to send Apple events')
  )
}

// Pede ao Finder o tamanho da Lixeira (dispara o diálogo de Automação)
export async function getTrashSizeViaFinder(): Promise<number> {
  const { stdout } = await execFileAsync(
    '/usr/bin/osascript',
    ['-e', 'tell application "Finder" to get size of trash'],
    { timeout: 30_000 }
  )
  return parseFinderSize(stdout)
}

// Esvazia a Lixeira pelo Finder, com as permissões que o macOS já concede a ele
export async function emptyTrashViaFinder(): Promise<void> {
  await execFileAsync(
    '/usr/bin/osascript',
    ['-e', 'tell application "Finder" to empty the trash'],
    { timeout: 180_000 }
  )
}
