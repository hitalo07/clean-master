import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function parseFinderSize(stdout: string): number {
  const value = Number(stdout.trim())
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export function pickTrashSize(
  fileSystemBytes: number | null,
  finderBytes: number | null
): { bytes: number; unknownSize: boolean } {
  if (fileSystemBytes !== null) {
    return { bytes: fileSystemBytes, unknownSize: false }
  }
  if (finderBytes !== null) {
    return { bytes: finderBytes, unknownSize: false }
  }
  return { bytes: 0, unknownSize: true }
}

export function isAutomationDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const stderr =
    error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '')
      : ''
  const text = `${message}\n${stderr}`
  return (
    text.includes('-1743') ||
    text.includes('PERMISSION_DENIED') ||
    text.includes('not allowed assistive') ||
    text.includes('Not authorised') ||
    text.includes('Not authorized') ||
    text.includes('not allowed to send Apple events')
  )
}

export function isTrashAlreadyEmpty(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('already empty') || message.includes('-1728')
}

export function isTrashCanceled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('-128') || message.toLowerCase().includes('user canceled')
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
    [
      '-e',
      'tell application "Finder"',
      '-e',
      'if (count of items of trash) is 0 then return',
      '-e',
      'empty trash',
      '-e',
      'end tell'
    ],
    { timeout: 180_000 }
  )
}
