import { describe, expect, it } from 'vitest'
import {
  isAutomationDenied,
  isTrashAlreadyEmpty,
  isTrashCanceled,
  parseFinderSize,
  pickTrashSize
} from './finder-trash'

describe('parseFinderSize', () => {
  it('lê o número devolvido pelo AppleScript', () => {
    expect(parseFinderSize('4096\n')).toBe(4096)
    expect(parseFinderSize('0')).toBe(0)
    expect(parseFinderSize('abc')).toBe(0)
  })
})

describe('pickTrashSize', () => {
  it('prefere o tamanho do disco e usa o Finder só quando o disco bloqueia', () => {
    expect(pickTrashSize(256, 999)).toEqual({ bytes: 256, unknownSize: false })
    expect(pickTrashSize(null, 4096)).toEqual({ bytes: 4096, unknownSize: false })
    expect(pickTrashSize(null, 0)).toEqual({ bytes: 0, unknownSize: false })
    expect(pickTrashSize(null, null)).toEqual({ bytes: 0, unknownSize: true })
  })
})

describe('isAutomationDenied', () => {
  it('reconhece recusa de Apple Events', () => {
    expect(isAutomationDenied(new Error('Not authorized to send Apple events. (-1743)'))).toBe(true)
    expect(isAutomationDenied({ stderr: 'PERMISSION_DENIED\n' })).toBe(true)
    expect(isAutomationDenied(new Error('ENOENT'))).toBe(false)
  })
})

describe('erros da Lixeira no Finder', () => {
  it('reconhece lixeira já vazia e cancelamento', () => {
    expect(isTrashAlreadyEmpty(new Error('The trash is already empty. (-1728)'))).toBe(true)
    expect(isTrashCanceled(new Error('User canceled. (-128)'))).toBe(true)
    expect(isTrashCanceled(new Error('EBUSY'))).toBe(false)
  })
})
