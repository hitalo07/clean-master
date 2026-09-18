import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { formatBytes } from '../../shared/format'
import { orbDashOffset } from '../../shared/orb'
import { permissionAppName } from '../../shared/flags'
import {
  CATEGORY_IDS,
  DOWNLOAD_KINDS,
  emptyCategoryScan,
  emptyKindBytes,
  type CategoryFile,
  type CategoryId,
  type CategoryScan,
  type DownloadKind,
  type ScanResult
} from '../../shared/categories'

type AppStatus = 'idle' | 'scanning' | 'ready' | 'confirm' | 'cleaning' | 'done' | 'error'

const THEME_KEY = 'clean-master-theme'

function readTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'light' ? 'light' : 'dark'
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme)
  const [status, setStatus] = useState<AppStatus>('idle')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [selected, setSelected] = useState<CategoryId[]>([])
  const [freedBytes, setFreedBytes] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [loginNeedsApproval, setLoginNeedsApproval] = useState(false)
  const [isPackaged, setIsPackaged] = useState(!import.meta.env.DEV)
  const [selectedKinds, setSelectedKinds] = useState<Record<DownloadKind, boolean>>({
    ipa: true,
    apk: true,
    aab: true,
    dmg: true
  })
  const [selectedDiskImages, setSelectedDiskImages] = useState<string[]>([])
  const appName = permissionAppName(isPackaged)
  const categoryRows = CATEGORY_IDS.map((id) => {
    const item = scan?.categories.find((entry) => entry.id === id) ?? emptyCategoryScan(id)
    return {
      ...item,
      kindBytes: item.kindBytes ?? emptyKindBytes(),
      files: item.files ?? []
    }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!window.cleanMaster?.getOpenAtLogin) {
      return
    }
    void window.cleanMaster.getOpenAtLogin().then((state) => {
      setOpenAtLogin(state.openAtLogin)
      setLoginNeedsApproval(state.requiresApproval)
    })
    if (window.cleanMaster.isPackaged) {
      void window.cleanMaster.isPackaged().then(setIsPackaged)
    }
  }, [])

  async function handleOpenAtLogin() {
    if (!window.cleanMaster?.setOpenAtLogin) {
      return
    }
    const state = await window.cleanMaster.setOpenAtLogin(!openAtLogin)
    setOpenAtLogin(state.openAtLogin)
    setLoginNeedsApproval(state.requiresApproval)
  }

  const selectedBytes = useMemo(() => {
    return categoryRows
      .filter((item) => selected.includes(item.id) && !item.permissionDenied)
      .reduce(
        (sum, item) =>
          sum + categoryPreviewBytes(item, selected.includes(item.id), selectedKinds, selectedDiskImages),
        0
      )
  }, [categoryRows, selected, selectedDiskImages, selectedKinds])

  const needsDiskAccess =
    scan?.categories.some(
      (item) => item.id !== 'downloads' && (item.permissionDenied || item.unknownSize)
    ) ?? false
  const needsDownloadsAccess =
    scan?.categories.some((item) => item.id === 'downloads' && item.permissionDenied) ??
    false

  const canClean = selected.some((id) => {
    const item = categoryRows.find((category) => category.id === id)
    if (!item || item.permissionDenied) {
      return false
    }
    if (item.id === 'trash') {
      return item.bytes > 0 || item.unknownSize
    }
    return categoryPreviewBytes(item, true, selectedKinds, selectedDiskImages) > 0
  })

  async function handleScan() {
    if (!window.cleanMaster) {
      setErrorMessage('Abra o app com npm run dev no Electron.')
      setStatus('error')
      return
    }
    setStatus('scanning')
    setScan(null)
    setFreedBytes(0)
    setErrorMessage('')
    setSelectedKinds({ ipa: true, apk: true, aab: true, dmg: true })
    try {
      const result = await window.cleanMaster.scan()
      setScan(result)
      setSelected(selectionAfterScan(result))
      setSelectedKinds({ ipa: true, apk: true, aab: true, dmg: true })
      setSelectedDiskImages(
        result.categories.find((item) => item.id === 'downloads')?.files.map((file) => file.relativePath) ??
          []
      )
      setStatus('ready')
    } catch (error) {
      if (isPermissionDenied(error)) {
        setErrorMessage(
          `O macOS bloqueou o acesso. Autorize o ${appName} em Ajustes e tente de novo.`
        )
      } else {
        setErrorMessage('Não foi possível analisar os arquivos.')
      }
      setStatus('error')
    }
  }

  async function handleDownloadsAccess() {
    if (!window.cleanMaster?.requestDownloadsAccess) {
      return
    }
    try {
      const result = await window.cleanMaster.requestDownloadsAccess()
      if (result.granted) {
        await handleScan()
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.includes('Selecione a pasta Downloads')
          ? 'Selecione a pasta Downloads para autorizar o acesso.'
          : 'Não foi possível autorizar a pasta Downloads.'
      )
    }
  }

  function resetToIdle() {
    setStatus('idle')
    setScan(null)
    setSelected([])
    setFreedBytes(0)
    setErrorMessage('')
    setSelectedKinds({ ipa: true, apk: true, aab: true, dmg: true })
    setSelectedDiskImages([])
  }

  async function handleClean() {
    if (selected.length === 0 || !canClean) {
      resetToIdle()
      return
    }
    if (selectedBytes === 0 && !selected.includes('trash')) {
      resetToIdle()
      return
    }
    setStatus('cleaning')
    try {
      const downloadKinds = DOWNLOAD_KINDS.filter((kind) => selectedKinds[kind])
      const result = await window.cleanMaster.clean({
        categoryIds: selected,
        downloadKinds: selected.includes('downloads') ? downloadKinds : [],
        diskImages: selected.includes('downloads') && selectedKinds.dmg ? selectedDiskImages : []
      })
      if (result.totalFreedBytes === 0) {
        resetToIdle()
        return
      }
      setFreedBytes(result.totalFreedBytes)
      setSelected([])
      setSelectedDiskImages([])
      setStatus('done')
    } catch (error) {
      if (isPermissionDenied(error)) {
        setStatus('ready')
        setErrorMessage(
          `O macOS bloqueou a exclusão. Dê permissão ao ${appName} para controlar o Finder (Lixeira), ou autorize Downloads e o Acesso Total ao Disco.`
        )
        return
      }
      const detail = userFacingCleanError(error)
      if (detail) {
        setStatus('ready')
        setErrorMessage(detail)
        return
      }
      resetToIdle()
    }
  }

  function toggleCategory(id: CategoryId) {
    const blocked = scan?.categories.find((item) => item.id === id)?.permissionDenied
    if (blocked) {
      if (id === 'downloads') {
        void handleDownloadsAccess()
        return
      }
      void window.cleanMaster?.openFullDiskAccess()
      return
    }
    setSelected((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      if (id === 'downloads' && next.includes('downloads')) {
        setSelectedKinds({ ipa: true, apk: true, aab: true, dmg: true })
        setSelectedDiskImages(
          scan?.categories
            .find((item) => item.id === 'downloads')
            ?.files.map((file) => file.relativePath) ?? []
        )
      }
      return next
    })
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#f4f6f8] text-slate-800 dark:bg-ink dark:text-slate-100">
      <aside className="titlebar flex w-[232px] shrink-0 flex-col border-r border-slate-200 bg-white/80 px-5 pb-5 pt-12 dark:border-line dark:bg-ink-soft/90">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-2 text-ink shadow-[0_8px_24px_rgba(61,220,151,0.28)]">
            <BroomIcon />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">Mac</p>
            <h1 className="text-lg font-semibold leading-none">Clean Master</h1>
          </div>
        </div>

        <nav className="no-drag flex flex-1 flex-col gap-2">
          <NavItem active label="Smart Scan" />
        </nav>

        <div className="no-drag mt-auto flex flex-col gap-2">
          <button
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-line dark:bg-panel"
            onClick={() => void handleOpenAtLogin()}
            type="button"
          >
            Abrir ao iniciar
            <span className="text-xs text-slate-400">{openAtLogin ? 'ligado' : 'desligado'}</span>
          </button>
          {loginNeedsApproval ? (
            <button
              className="text-left text-xs text-amber-600 dark:text-amber-300"
              onClick={() => void window.cleanMaster?.openLoginItemsSettings()}
              type="button"
            >
              Autorizar em Ajustes → Itens de Início
            </button>
          ) : null}
          <button
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-line dark:bg-panel"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            type="button"
          >
            Tema {theme === 'dark' ? 'escuro' : 'claro'}
            <span className="text-xs text-slate-400">{theme === 'dark' ? '☾' : '☀'}</span>
          </button>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="titlebar h-11 shrink-0" />
        <div className="flex flex-1 items-start justify-center overflow-y-auto px-8 py-4">
          <section className="rise-in my-auto w-full max-w-3xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(16,32,51,0.08)] dark:border-line dark:bg-panel dark:shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
            {status === 'done' ? (
              <SuccessScreen bytes={freedBytes} onAgain={handleScan} />
            ) : (
              <>
            <ScanOrb
              bytes={status === 'ready' || status === 'confirm' ? selectedBytes : (scan?.totalBytes ?? 0)}
              scanning={status === 'scanning' || status === 'cleaning'}
              status={status}
            />

            <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">
              {copyForStatus(status, selectedBytes)}
            </p>

            {needsDownloadsAccess && (status === 'ready' || status === 'confirm') ? (
              <DownloadsBanner onAllow={() => void handleDownloadsAccess()} />
            ) : null}

            {needsDiskAccess && (status === 'ready' || status === 'confirm') ? (
              <PermissionBanner isPackaged={isPackaged} />
            ) : null}

            {status === 'ready' || status === 'confirm' ? (
              <div className="mt-5 grid gap-3">
                {categoryRows.map((item, index) => (
                  <div key={item.id}>
                    <CategoryRow
                      item={item}
                      previewBytes={categoryPreviewBytes(
                        item,
                        selected.includes(item.id),
                        selectedKinds,
                        selectedDiskImages
                      )}
                      selected={selected.includes(item.id)}
                      disabled={status !== 'ready' && status !== 'confirm'}
                      delay={index * 60}
                      onToggle={() => toggleCategory(item.id)}
                    />
                    {item.id === 'downloads' &&
                    selected.includes('downloads') &&
                    !item.permissionDenied &&
                    (status === 'ready' || status === 'confirm') ? (
                      <DownloadsOptions
                        kindBytes={item.kindBytes}
                        selectedKinds={selectedKinds}
                        diskImages={item.files}
                        selectedDiskImages={selectedDiskImages}
                        onToggleKind={(kind) =>
                          setSelectedKinds((current) => ({ ...current, [kind]: !current[kind] }))
                        }
                        onToggleDiskImage={(relativePath) =>
                          setSelectedDiskImages((current) =>
                            current.includes(relativePath)
                              ? current.filter((path) => path !== relativePath)
                              : [...current, relativePath]
                          )
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {errorMessage ? (
              <p className="mt-6 text-center text-sm text-red-400">{errorMessage}</p>
            ) : null}

            <div className="mt-5 flex justify-center gap-3">
              {status === 'idle' || status === 'error' ? (
                <PrimaryButton onClick={handleScan}>Analisar agora</PrimaryButton>
              ) : null}
              {status === 'ready' ? (
                <>
                  <GhostButton onClick={handleScan}>Analisar de novo</GhostButton>
                  <PrimaryButton
                    disabled={!canClean}
                    onClick={() => setStatus('confirm')}
                  >
                    Liberar {formatBytes(selectedBytes)}
                  </PrimaryButton>
                </>
              ) : null}
              {status === 'confirm' ? (
                <>
                  <GhostButton onClick={() => setStatus('ready')}>Cancelar</GhostButton>
                  <PrimaryButton onClick={handleClean}>
                    Confirmar limpeza
                  </PrimaryButton>
                </>
              ) : null}
            </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

function selectionAfterScan(result: ScanResult): CategoryId[] {
  const selected = result.categories
    .filter((item) => !item.permissionDenied)
    .map((item) => item.id)
  if (!selected.includes('downloads')) {
    selected.push('downloads')
  }
  return selected
}

function categoryPreviewBytes(
  item: CategoryScan,
  isSelected: boolean,
  selectedKinds: Record<DownloadKind, boolean>,
  selectedDiskImages: string[]
): number {
  if (!isSelected || item.permissionDenied) {
    return 0
  }
  if (item.id !== 'downloads') {
    return item.bytes
  }
  const artifacts = (['ipa', 'apk', 'aab'] as const).reduce(
    (total, kind) => total + (selectedKinds[kind] ? item.kindBytes[kind] : 0),
    0
  )
  const disks = selectedKinds.dmg
    ? item.files
        .filter((file) => selectedDiskImages.includes(file.relativePath))
        .reduce((total, file) => total + file.bytes, 0)
    : 0
  return artifacts + disks
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof Error && error.message.includes('PERMISSION_DENIED')
}

function userFacingCleanError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }
  if (error.message.includes('Lixeira foi cancelada')) {
    return 'A exclusão da Lixeira foi cancelada no diálogo do macOS.'
  }
  return null
}

function copyForStatus(status: AppStatus, selectedBytes: number): string {
  if (status === 'scanning') {
    return 'Pedindo permissões e em seguida analisando Xcode, Simulator, Lixeira e Downloads…'
  }
  if (status === 'cleaning') {
    return 'Removendo os arquivos selecionados…'
  }
  if (status === 'confirm') {
    return `Isso apaga ${formatBytes(selectedBytes)} do que você marcou. Em Downloads só saem as extensões e os DMGs selecionados.`
  }
  if (status === 'ready') {
    return selectedBytes > 0
      ? `A análise encontrou ${formatBytes(selectedBytes)} para liberar. Desmarque o que quiser manter.`
      : 'Selecione o que deseja remover. Nada fora das pastas permitidas é alterado.'
  }
  return 'Encontre lixo do Xcode, esvazie a Lixeira e limpe Downloads (.ipa, .apk, .aab e .dmg).'
}

function DownloadsOptions({
  kindBytes,
  selectedKinds,
  diskImages,
  selectedDiskImages,
  onToggleKind,
  onToggleDiskImage
}: {
  kindBytes: Record<DownloadKind, number>
  selectedKinds: Record<DownloadKind, boolean>
  diskImages: CategoryFile[]
  selectedDiskImages: string[]
  onToggleKind: (kind: DownloadKind) => void
  onToggleDiskImage: (relativePath: string) => void
}) {
  const labels: Record<DownloadKind, string> = {
    ipa: 'Arquivos .ipa',
    apk: 'Arquivos .apk',
    aab: 'Arquivos .aab',
    dmg: 'Arquivos .dmg'
  }

  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-line dark:bg-panel">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
        Escolha o que apagar em Downloads
      </p>
      <div className="mt-3 grid gap-2">
        {DOWNLOAD_KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-3 text-sm">
            <input
              checked={selectedKinds[kind]}
              onChange={() => onToggleKind(kind)}
              type="checkbox"
            />
            <span className="flex-1">{labels[kind]}</span>
            <span className="text-xs text-slate-400">{formatBytes(kindBytes[kind])}</span>
          </label>
        ))}
      </div>
      {selectedKinds.dmg ? (
        <>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Quais DMGs apagar
          </p>
          {diskImages.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nenhum .dmg encontrado em Downloads.</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
              {diskImages.map((file) => (
                <li key={file.relativePath}>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      checked={selectedDiskImages.includes(file.relativePath)}
                      onChange={() => onToggleDiskImage(file.relativePath)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{formatBytes(file.bytes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  )
}

function SuccessScreen({ bytes, onAgain }: { bytes: number; onAgain: () => void }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="relative flex h-44 w-44 items-center justify-center">
        <div className="pulse-glow absolute inset-4 rounded-full bg-gradient-to-br from-accent/40 to-accent-2/30 blur-2xl" />
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-ink shadow-[0_16px_40px_rgba(61,220,151,0.35)]">
          <BroomIcon />
        </div>
      </div>
      <p className="mt-2 text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
        Tudo limpo
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
        {formatBytes(bytes)}
      </p>
      <p className="mt-3 max-w-md text-sm text-slate-500 dark:text-slate-400">
        Seu Mac está mais leve. Esse espaço foi varrido e liberado das pastas que você escolheu.
      </p>
      <div className="mt-6">
        <PrimaryButton onClick={onAgain}>Nova análise</PrimaryButton>
      </div>
    </div>
  )
}

function DownloadsBanner({ onAllow }: { onAllow: () => void }) {
  return (
    <div className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      <p>
        O macOS bloqueou a pasta Downloads. Autorize o acesso para o app encontrar arquivos
        .ipa, .apk, .aab e .dmg. Nada além desses arquivos será apagado.
      </p>
      <button
        className="no-drag mt-3 rounded-full border border-amber-400/50 px-4 py-1.5 text-xs font-semibold"
        onClick={onAllow}
        type="button"
      >
        Permitir pasta Downloads
      </button>
    </div>
  )
}

function PermissionBanner({ isPackaged }: { isPackaged: boolean }) {
  const appName = permissionAppName(isPackaged)

  return (
    <div className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      <p>
        O macOS não coloca o {appName} sozinho nessa lista. Clique em <strong>+</strong> e
        escolha <strong>{appName}</strong> no Finder.
      </p>
      <p className="mt-1 text-xs opacity-80">
        {isPackaged
          ? 'Para a Lixeira, aceite o pedido de controlar o Finder se o sistema mostrar.'
          : 'Em desenvolvimento o app aparece como Electron. No diálogo do +, use Command+Shift+G e cole o caminho — ele já foi copiado. Para a Lixeira, aceite o pedido de controlar o Finder se o sistema mostrar.'}
      </p>
      <button
        className="no-drag mt-3 rounded-full border border-amber-400/50 px-4 py-1.5 text-xs font-semibold"
        onClick={() => void window.cleanMaster?.openFullDiskAccess()}
        type="button"
      >
        Mostrar app e abrir Ajustes
      </button>
    </div>
  )
}

function ScanOrb({
  bytes,
  scanning,
  status
}: {
  bytes: number
  scanning: boolean
  status: AppStatus
}) {
  const gradientId = `orb-${useId().replaceAll(':', '')}`

  return (
    <div className="relative mx-auto flex h-48 w-48 items-center justify-center">
      <div
        className={`pulse-glow absolute inset-6 rounded-full bg-gradient-to-br from-accent/30 to-accent-2/20 blur-2xl ${
          bytes <= 0 && !scanning ? 'opacity-20' : ''
        }`}
      />
      <svg
        aria-hidden="true"
        className={scanning ? 'spin-slow' : ''}
        height="192"
        viewBox="0 0 256 256"
        width="192"
      >
        <title>Indicador de espaço encontrado</title>
        <circle cx="128" cy="128" fill="none" r="108" stroke="currentColor" strokeOpacity="0.12" strokeWidth="10" />
        <circle
          cx="128"
          cy="128"
          fill="none"
          r="108"
          stroke={`url(#${gradientId})`}
          strokeDasharray="420"
          strokeDashoffset={orbDashOffset(bytes, scanning)}
          strokeLinecap="round"
          strokeWidth="10"
          className="transition-[stroke-dashoffset] duration-700"
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#3DDC97" />
            <stop offset="100%" stopColor="#4C8DFF" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
          {status === 'done' ? 'liberado' : 'encontrado'}
        </p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {scanning ? '…' : formatBytes(bytes)}
        </p>
      </div>
    </div>
  )
}

function CategoryRow({
  item,
  previewBytes,
  selected,
  disabled,
  delay,
  onToggle
}: {
  item: CategoryScan
  previewBytes: number
  selected: boolean
  disabled: boolean
  delay: number
  onToggle: () => void
}) {
  return (
    <button
      className="rise-in flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-accent/50 dark:border-line dark:bg-ink-soft"
      disabled={disabled}
      onClick={onToggle}
      style={{ animationDelay: `${delay}ms` }}
      type="button"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-md border ${
          selected
            ? 'border-accent bg-accent text-ink'
            : item.permissionDenied
              ? 'border-amber-400 text-amber-400'
              : 'border-slate-300 dark:border-line'
        }`}
      >
        {selected ? '✓' : item.permissionDenied ? '!' : ''}
      </span>
      <span className="flex-1">
        <span className="block font-medium">{item.label}</span>
        <span className="block text-sm text-slate-500">
          {item.permissionDenied
            ? 'Acesso bloqueado pelo macOS'
            : item.unknownSize && item.bytes === 0
              ? 'Tamanho oculto — a limpeza usa o Finder'
              : item.description}
        </span>
      </span>
      <span className="text-sm font-semibold text-accent-2">
        {item.permissionDenied
          ? 'Permitir'
          : item.unknownSize && item.bytes === 0
            ? 'Lixeira'
            : formatBytes(selected ? previewBytes : item.bytes)}
      </span>
    </button>
  )
}

function NavItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={`rounded-2xl px-3 py-2 text-sm ${
        active
          ? 'bg-accent/15 font-medium text-emerald-700 dark:text-accent'
          : 'text-slate-400'
      }`}
    >
      {label}
    </div>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled = false
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      className="no-drag rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-3 text-sm font-semibold text-ink shadow-[0_12px_30px_rgba(76,141,255,0.28)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function GhostButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="no-drag rounded-full border border-slate-200 px-6 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-line dark:text-slate-300 dark:hover:bg-ink-soft"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function BroomIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <title>Clean Master</title>
      <path
        d="M15.2 3.2c.4-.4 1-.4 1.4 0l4.2 4.2c.4.4.4 1 0 1.4L19.6 10 14 4.4l1.2-1.2Z"
        fill="currentColor"
      />
      <path
        d="M13.4 6.2 6.4 13.2c-.9.9-1.1 2.3-.6 3.5l-2.6 2.6 1.5 1.5 2.6-2.6c1.2.5 2.6.3 3.5-.6l7-7-4.4-4.4Z"
        fill="currentColor"
      />
    </svg>
  )
}
