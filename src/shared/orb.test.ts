import { describe, expect, it } from 'vitest'
import { ORB_CIRCUMFERENCE, orbDashOffset } from './orb'

describe('orbDashOffset', () => {
  it('fica vazio com 0 B e cheio quando há espaço encontrado', () => {
    expect(orbDashOffset(0, false)).toBe(ORB_CIRCUMFERENCE)
    expect(orbDashOffset(1024, false)).toBe(80)
    expect(orbDashOffset(0, true)).toBe(120)
  })
})
