import { describe, expect, it } from 'vitest'
import { isAutomationDenied, parseFinderSize } from './finder-trash'

describe('parseFinderSize', () => {
  it('lê o número devolvido pelo AppleScript', () => {
    expect(parseFinderSize('4096\n')).toBe(4096)
    expect(parseFinderSize('0')).toBe(0)
    expect(parseFinderSize('abc')).toBe(0)
  })
})

describe('isAutomationDenied', () => {
  it('reconhece recusa de Apple Events', () => {
    expect(isAutomationDenied(new Error('Not authorized to send Apple events. (-1743)'))).toBe(true)
    expect(isAutomationDenied(new Error('ENOENT'))).toBe(false)
  })
})
