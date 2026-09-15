import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDeveloperArtifactName } from '../shared/categories'
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
  await mkdir(path.join(home, 'Downloads', 'builds'), { recursive: true })
  await writeFile(path.join(home, 'Downloads', 'app.ipa'), 'i'.repeat(100))
  await writeFile(path.join(home, 'Downloads', 'game.APK'), 'k'.repeat(200))
  await writeFile(path.join(home, 'Downloads', 'store.aab'), 'b'.repeat(50))
  await writeFile(path.join(home, 'Downloads', 'notes.txt'), 'n'.repeat(999))
  await writeFile(path.join(home, 'Downloads', 'builds', 'nested.ipa'), 'p'.repeat(80))
  return home
}

describe('isDeveloperArtifactName', () => {
  it('aceita só .ipa, .apk e .aab', () => {
    expect(isDeveloperArtifactName('app.ipa')).toBe(true)
    expect(isDeveloperArtifactName('game.APK')).toBe(true)
    expect(isDeveloperArtifactName('store.aab')).toBe(true)
    expect(isDeveloperArtifactName('notes.txt')).toBe(false)
    expect(isDeveloperArtifactName('.ipa')).toBe(false)
    expect(isDeveloperArtifactName('app.ipa.bak')).toBe(false)
  })
})

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
    expect(resolveCategoryDir('/Users/demo', 'developerArtifacts')).toBe(
      path.resolve('/Users/demo/Downloads')
    )
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

    expect(result.totalBytes).toBe(2048 + 1024 + 512 + 256 + 430)
    expect(result.categories.map((item) => item.id)).toEqual([
      'derivedData',
      'archives',
      'iosDeviceSupport',
      'trash',
      'developerArtifacts'
    ])
    expect(result.categories.find((item) => item.id === 'developerArtifacts')?.bytes).toBe(430)
  })

  it('remove só .ipa, .apk e .aab e deixa o resto de Downloads', async () => {
    const home = await makeFakeHome()
    const cleaned = await cleanCategories(home, ['developerArtifacts'])
    const after = await scanCategories(home)

    expect(cleaned.totalFreedBytes).toBe(430)
    expect(after.categories.find((item) => item.id === 'developerArtifacts')?.bytes).toBe(0)
    expect(await readFile(path.join(home, 'Downloads', 'notes.txt'), 'utf8')).toBe('n'.repeat(999))
    expect(after.categories.find((item) => item.id === 'derivedData')?.bytes).toBe(2048)
  })

  it('recusa esvaziar Downloads por completo', async () => {
    const home = await makeFakeHome()
    await expect(emptyDirectory(home, path.join(home, 'Downloads'))).rejects.toThrow(
      'Downloads não pode ser esvaziada'
    )
    expect(await readFile(path.join(home, 'Downloads', 'notes.txt'), 'utf8')).toBe('n'.repeat(999))
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

  it('volta a contar arquivos criados depois da limpeza', async () => {
    const home = await makeFakeHome()
    await cleanCategories(home, ['derivedData', 'trash'])

    await mkdir(path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData', 'NewApp'), {
      recursive: true
    })
    await writeFile(
      path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData', 'NewApp', 'cache.bin'),
      'e'.repeat(4096)
    )
    await writeFile(path.join(home, '.Trash', 'novo.zip'), 'f'.repeat(128))

    const result = await scanCategories(home)
    expect(result.categories.find((item) => item.id === 'derivedData')?.bytes).toBe(4096)
    expect(result.categories.find((item) => item.id === 'trash')?.bytes).toBe(128)
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
