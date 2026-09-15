import { describe, expect, it } from 'vitest'
import { parseEnabledFlag } from './flags'

describe('parseEnabledFlag', () => {
  it('aceita boolean', () => {
    expect(parseEnabledFlag(true)).toBe(true)
    expect(parseEnabledFlag(false)).toBe(false)
  })

  it('rejeita valor inválido', () => {
    expect(() => parseEnabledFlag('true')).toThrow('Seleção inválida')
  })
})
