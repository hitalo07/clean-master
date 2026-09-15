import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { formatBytes } from '../../shared/format'
import { permissionAppName } from '../../shared/flags'
import type { CategoryId, CategoryScan, ScanResult } from '../../shared/categories'

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
  const appName = permissionAppName(isPackaged)

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
    if (!scan) {
      return 0
    }
    return scan.categories
      .filter((item) => selected.includes(item.id) && !item.permissionDenied)
      .reduce((sum, item) => sum + item.bytes, 0)
  }, [scan, selected])

  const needsDiskAccess =
    scan?.categories.some(
      (item) => item.id !== 'developerArtifacts' && (item.permissionDenied || item.unknownSize)
    ) ?? false
  const needsDownloadsAccess =
    scan?.categories.some((item) => item.id === 'developerArtifacts' && item.permissionDenied) ??
    false

  const canClean = selected.some((id) => {
    const item = scan?.categories.find((category) => category.id === id)
    return Boolean(item && !item.permissionDenied)
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
    try {
      const result = await window.cleanMaster.scan()
      setScan(result)
      setSelected(result.categories.filter((item) => !item.permissionDenied).map((item) => item.id))
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

  async function handleClean() {
    if (selected.length === 0 || !canClean) {
      return
    }
    setStatus('cleaning')
    try {
      const result = await window.cleanMaster.clean(selected)
      setFreedBytes(result.totalFreedBytes)
      setScan((current) =>
        current
          ? {
              ...current,
              totalBytes: current.categories
                .filter((item) => !selected.includes(item.id))
                .reduce((sum, item) => sum + item.bytes, 0),
              categories: current.categories.map((item) =>
                selected.includes(item.id) ? { ...item, bytes: 0 } : item
              )
            }
          : current
      )
      setSelected([])
      setStatus('done')
    } catch (error) {
      setStatus('ready')
      if (isPermissionDenied(error)) {
        setErrorMessage(
          `O macOS bloqueou a exclusão. Dê permissão ao ${appName} em Downloads, no Finder ou no Acesso Total ao Disco e tente de novo.`
        )
        return
      }
      setErrorMessage('Não foi possível limpar os arquivos selecionados. Feche o Xcode e tente de novo.')
    }
  }

  function toggleCategory(id: CategoryId) {
    const blocked = scan?.categories.find((item) => item.id === id)?.permissionDenied
    if (blocked) {
      if (id === 'developerArtifacts') {
        void handleDownloadsAccess()
        return
      }
      void window.cleanMaster?.openFullDiskAccess()
      return
    }
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
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
            <ScanOrb
              bytes={status === 'done' ? freedBytes : scan?.totalBytes ?? 0}
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

            {scan && (status === 'ready' || status === 'confirm' || status === 'done') ? (
              <div className="mt-5 grid gap-3">
                {scan.categories.map((item, index) => (
                  <CategoryRow
                    key={item.id}
                    item={item}
                    selected={selected.includes(item.id)}
                    disabled={status !== 'ready' && status !== 'confirm'}
                    delay={index * 60}
                    onToggle={() => toggleCategory(item.id)}
                  />
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
              {status === 'done' ? (
                <PrimaryButton onClick={handleScan}>Nova análise</PrimaryButton>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof Error && error.message.includes('PERMISSION_DENIED')
}

function copyForStatus(status: AppStatus, selectedBytes: number): string {
  if (status === 'scanning') {
    return 'Varrendo lixo do Xcode, a Lixeira e artefatos em Downloads…'
  }
  if (status === 'cleaning') {
    return 'Removendo os arquivos selecionados…'
  }
  if (status === 'confirm') {
    return `Isso apaga ${formatBytes(selectedBytes)} das pastas selecionadas. Artefatos de desenvolvedor remove só .ipa, .apk e .aab em Downloads.`
  }
  if (status === 'done') {
    return 'Limpeza concluída. O Xcode volta a gerar esses arquivos quando você abrir um projeto.'
  }
  if (status === 'ready') {
    return 'Selecione o que deseja remover. Nada fora das pastas permitidas é alterado.'
  }
  return 'Encontre lixo do Xcode, esvazie a Lixeira e remova .ipa, .apk e .aab de Downloads.'
}

function DownloadsBanner({ onAllow }: { onAllow: () => void }) {
  return (
    <div className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      <p>
        O macOS bloqueou a pasta Downloads. Autorize o acesso para o app encontrar arquivos
        .ipa, .apk e .aab. Nada além desses arquivos será apagado.
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
      <div className="pulse-glow absolute inset-6 rounded-full bg-gradient-to-br from-accent/30 to-accent-2/20 blur-2xl" />
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
          strokeDashoffset={scanning ? '120' : '280'}
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
  selected,
  disabled,
  delay,
  onToggle
}: {
  item: CategoryScan
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
          item.permissionDenied
            ? 'border-amber-400 text-amber-400'
            : selected
              ? 'border-accent bg-accent text-ink'
              : 'border-slate-300 dark:border-line'
        }`}
      >
        {item.permissionDenied ? '!' : selected ? '✓' : ''}
      </span>
      <span className="flex-1">
        <span className="block font-medium">{item.label}</span>
        <span className="block text-sm text-slate-500">
          {item.permissionDenied
            ? 'Acesso bloqueado pelo macOS'
            : item.unknownSize
              ? 'Tamanho oculto — a limpeza usa o Finder'
              : item.description}
        </span>
      </span>
      <span className="text-sm font-semibold text-accent-2">
        {item.permissionDenied ? 'Permitir' : item.unknownSize ? 'Lixeira' : formatBytes(item.bytes)}
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
