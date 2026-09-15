import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { needsDownloadsPrompt, needsFullDiskAccess, isSameDownloadsFolder, resolveFinderAutomationHelper } from './scan-permissions'

describe('needsDownloadsPrompt', () => {
  it('não pede se Downloads tem arquivos e é legível', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'clean-master-perm-'))
    await mkdir(path.join(home, 'Downloads'))
    await writeFile(path.join(home, 'Downloads', 'notes.txt'), 'ok')
    expect(await needsDownloadsPrompt(home)).toBe(false)
  })

  it('pede se Downloads está vazia — o macOS pode listar vazio sem permissão', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'clean-master-perm-'))
    await mkdir(path.join(home, 'Downloads'))
    expect(await needsDownloadsPrompt(home)).toBe(true)
  })
})

describe('isSameDownloadsFolder', () => {
  it('aceita a pasta Downloads mesmo por symlink', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'clean-master-perm-'))
    const downloads = path.join(home, 'Downloads')
    await mkdir(downloads)
    const aliasDir = path.join(home, 'other')
    await mkdir(aliasDir)
    const alias = path.join(aliasDir, 'Downloads')
    await symlink(downloads, alias)
    expect(await isSameDownloadsFolder(alias, downloads)).toBe(true)
    expect(await isSameDownloadsFolder(path.join(home, 'Documents'), downloads)).toBe(false)
  })
})

describe('needsFullDiskAccess', () => {
  it('não pede se as pastas protegidas estão ausentes ou legíveis', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'clean-master-perm-'))
    expect(await needsFullDiskAccess(home)).toBe(false)
  })
})

describe('Apple Events no pacote', () => {
  it('inclui a entitlement que libera o diálogo de controle do Finder', () => {
    const plist = readFileSync(path.join(__dirname, '../../build/entitlements.mac.plist'), 'utf8')
    expect(plist).toContain('com.apple.security.automation.apple-events')
  })

  it('resolve o helper de Automação no app empacotado e no dev', () => {
    expect(resolveFinderAutomationHelper(true, '/App/Resources', '/tmp/out/main')).toBe(
      '/App/Resources/ask-finder-automation'
    )
    expect(resolveFinderAutomationHelper(false, '/App/Resources', '/tmp/out/main')).toBe(
      path.join('/tmp/out/main', '../../build/ask-finder-automation')
    )
  })
})
