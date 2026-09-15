import { describe, expect, it } from 'vitest'
import { parseEnabledFlag, permissionAppName } from './flags'

describe('permissionAppName', () => {
  it('usa Electron só em desenvolvimento', () => {
    expect(permissionAppName(false)).toBe('Electron')
    expect(permissionAppName(true)).toBe('Clean Master')
  })
})

describe('parseEnabledFlag', () => {
  it('aceita boolean', () => {
    expect(parseEnabledFlag(true)).toBe(true)
    expect(parseEnabledFlag(false)).toBe(false)
  })

  it('rejeita valor inválido', () => {
    expect(() => parseEnabledFlag('true')).toThrow('Seleção inválida')
  })
})
