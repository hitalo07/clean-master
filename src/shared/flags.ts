export function permissionAppName(isPackaged: boolean): string {
  return isPackaged ? 'Clean Master' : 'Electron'
}

// Valida um boolean vindo do renderer
export function parseEnabledFlag(input: unknown): boolean {
  if (typeof input !== 'boolean') {
    throw new Error('Seleção inválida')
  }
  return input
}
