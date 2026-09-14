import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertInsideAllowedRoot,
  cleanCategories,
  emptyDirectory,
  isFsPermissionError,
  parseCategoryIds,
  resolveCategoryDir,
  scanCategories
} from './cleanup'

async function makeFakeHome(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'clean-master-'))
  const xcode = path.join(home, 'Library', 'Developer', 'Xcode')
  await mkdir(path.join(xcode, 'DerivedData', 'MyApp'), { recursive: true })
  await mkdir(path.join(xcode, 'Archives', '2026-01-01'), { recursive: true })
  await mkdir(path.join(xcode, 'iOS DeviceSupport', 'iPhone'), { recursive: true })
  await mkdir(path.join(home, '.Trash'), { recursive: true })
  await writeFile(path.join(xcode, 'DerivedData', 'MyApp', 'cache.bin'), 'a'.repeat(2048))
  await writeFile(path.join(xcode, 'Archives', '2026-01-01', 'app.xcarchive'), 'b'.repeat(1024))
  await writeFile(path.join(xcode, 'iOS DeviceSupport', 'iPhone', 'symbols'), 'c'.repeat(512))
  await writeFile(path.join(home, '.Trash', 'old.zip'), 'd'.repeat(256))
  return home
}

describe('parseCategoryIds', () => {
  it('aceita apenas IDs da lista branca', () => {
    expect(parseCategoryIds(['derivedData', 'trash'])).toEqual(['derivedData', 'trash'])
  })

  it('rejeita ID desconhecido', () => {
    expect(() => parseCategoryIds(['derivedData', '../etc'])).toThrow('Seleção inválida')
  })

  it('rejeita payload que não é lista', () => {
    expect(() => parseCategoryIds('derivedData')).toThrow('Seleção inválida')
  })
})

describe('resolveCategoryDir', () => {
  it('resolve pastas do Xcode e da Lixeira dentro do home', () => {
    expect(resolveCategoryDir('/Users/demo', 'derivedData')).toBe(
      path.resolve('/Users/demo/Library/Developer/Xcode/DerivedData')
    )
    expect(resolveCategoryDir('/Users/demo', 'trash')).toBe(path.resolve('/Users/demo/.Trash'))
  })

  it('bloqueia caminho fora da área permitida', () => {
    expect(() =>
      assertInsideAllowedRoot(
        path.resolve('/Users/demo'),
        path.resolve('/Users/demo/../Secrets')
      )
    ).toThrow('Caminho fora da área permitida')
  })
})

describe('isFsPermissionError', () => {
  it('reconhece EACCES e EPERM', () => {
    expect(isFsPermissionError({ code: 'EACCES' })).toBe(true)
    expect(isFsPermissionError({ code: 'EPERM' })).toBe(true)
    expect(isFsPermissionError({ code: 'ENOENT' })).toBe(false)
  })
})

describe('scan e clean', () => {
  it('soma o tamanho das categorias incluindo a Lixeira', async () => {
    const home = await makeFakeHome()
    const result = await scanCategories(home)

    expect(result.totalBytes).toBe(2048 + 1024 + 512 + 256)
    expect(result.categories.map((item) => item.id)).toEqual([
      'derivedData',
      'archives',
      'iosDeviceSupport',
      'trash'
    ])
  })

  it('esvazia só a categoria pedida', async () => {
    const home = await makeFakeHome()
    const cleaned = await cleanCategories(home, ['derivedData'])
    const after = await scanCategories(home)

    expect(cleaned.totalFreedBytes).toBe(2048)
    expect(after.categories.find((item) => item.id === 'derivedData')?.bytes).toBe(0)
    expect(after.categories.find((item) => item.id === 'archives')?.bytes).toBe(1024)
    expect(after.categories.find((item) => item.id === 'trash')?.bytes).toBe(256)
  })

  it('esvazia a Lixeira sem apagar a pasta .Trash', async () => {
    const home = await makeFakeHome()
    const cleaned = await cleanCategories(home, ['trash'])
    const after = await scanCategories(home)

    expect(cleaned.totalFreedBytes).toBe(256)
    expect(after.categories.find((item) => item.id === 'trash')?.bytes).toBe(0)
    expect(after.categories.find((item) => item.id === 'trash')?.exists).toBe(true)
  })

  it('marca pasta sem permissão de leitura', async () => {
    const home = await makeFakeHome()
    const trash = path.join(home, '.Trash')
    await chmod(trash, 0)

    try {
      const result = await scanCategories(home)
      expect(result.categories.find((item) => item.id === 'trash')?.unknownSize).toBe(true)
      expect(result.categories.find((item) => item.id === 'trash')?.permissionDenied).toBe(false)
    } finally {
      await chmod(trash, 0o700)
    }
  })

  it('remove symlink sem apagar o arquivo apontado fora da área', async () => {
    const home = await makeFakeHome()
    const outside = path.join(home, 'outside.txt')
    await writeFile(outside, 'nao-apague')
    const link = path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData', 'escape')
    await symlink(outside, link)

    await emptyDirectory(home, path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'))

    expect(await readFile(outside, 'utf8')).toBe('nao-apague')
  })
})
