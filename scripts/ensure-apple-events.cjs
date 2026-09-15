const { execFileSync } = require('node:child_process')
const { existsSync, statSync } = require('node:fs')
const path = require('node:path')

const USAGE =
  'O Clean Master usa o Finder para medir o tamanho da Lixeira e esvaziá-la.'
const DOWNLOADS_USAGE =
  'O Clean Master acessa Downloads só para encontrar arquivos .ipa, .apk, .aab e .dmg.'
const ROOT = path.join(__dirname, '..')
const HELPER_SRC = path.join(ROOT, 'native', 'ask-finder-automation.swift')
const HELPER_OUT = path.join(ROOT, 'build', 'ask-finder-automation')

function electronInfoPlist() {
  const binary = require('electron')
  return path.join(path.dirname(binary), '..', 'Info.plist')
}

function electronAppPath() {
  const binary = require('electron')
  return path.resolve(path.dirname(binary), '..', '..')
}

function hasPlistKey(plist, key) {
  try {
    execFileSync('plutil', ['-extract', key, 'raw', plist], {
      stdio: 'pipe'
    })
    return true
  } catch {
    return false
  }
}

function ensurePrivacyUsageDescriptions() {
  const plist = electronInfoPlist()
  const keys = {
    NSAppleEventsUsageDescription: USAGE,
    NSDownloadsFolderUsageDescription: DOWNLOADS_USAGE
  }
  let changed = false
  for (const [key, value] of Object.entries(keys)) {
    if (!hasPlistKey(plist, key)) {
      execFileSync('plutil', ['-insert', key, '-string', value, plist])
      changed = true
    }
  }
  if (changed) {
    execFileSync('codesign', ['--force', '--sign', '-', electronAppPath()], { stdio: 'pipe' })
  }
}

function helperNeedsCompile() {
  if (!existsSync(HELPER_OUT)) {
    return true
  }
  return statSync(HELPER_SRC).mtimeMs > statSync(HELPER_OUT).mtimeMs
}

function compileFinderHelper(universal = false) {
  if (!universal && !helperNeedsCompile()) {
    return
  }
  if (universal) {
    const arm = path.join(ROOT, 'build', 'ask-finder-automation-arm64')
    const intel = path.join(ROOT, 'build', 'ask-finder-automation-x64')
    execFileSync('swiftc', ['-O', '-target', 'arm64-apple-macos13', '-o', arm, HELPER_SRC], {
      stdio: 'pipe'
    })
    execFileSync('swiftc', ['-O', '-target', 'x86_64-apple-macos13', '-o', intel, HELPER_SRC], {
      stdio: 'pipe'
    })
    execFileSync('lipo', ['-create', arm, intel, '-output', HELPER_OUT], { stdio: 'pipe' })
  } else {
    execFileSync('swiftc', ['-O', '-o', HELPER_OUT, HELPER_SRC], { stdio: 'pipe' })
  }
  execFileSync('codesign', ['--force', '--sign', '-', HELPER_OUT], { stdio: 'pipe' })
}

function ensureDevAutomation() {
  compileFinderHelper(process.argv.includes('--universal'))
  ensurePrivacyUsageDescriptions()
}

module.exports = {
  USAGE,
  DOWNLOADS_USAGE,
  HELPER_OUT,
  hasPlistKey,
  ensurePrivacyUsageDescriptions,
  compileFinderHelper,
  ensureDevAutomation
}

if (require.main === module) {
  ensureDevAutomation()
}
