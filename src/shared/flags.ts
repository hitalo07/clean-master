// Valida um boolean vindo do renderer
export function parseEnabledFlag(input: unknown): boolean {
  if (typeof input !== 'boolean') {
    throw new Error('Seleção inválida')
  }
  return input
}
