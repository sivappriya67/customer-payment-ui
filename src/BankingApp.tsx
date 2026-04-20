import { useState, useEffect } from 'react'
import './BankingApp.css'
import type { AccountData } from './CustomerView'
import PaymentView, { type PaymentResult, type Beneficiary } from './PaymentView'

interface Props {
  data: AccountData | null
  loading: boolean
  appView: 'home' | 'payment'
  payStatus: 'idle' | 'processing' | 'done'
  payResult: PaymentResult | null
  payBene?: Beneficiary
  intentReady: boolean
  onSendMoney: () => void
  onPayBack: () => void
  onPay: (amount: number, note: string, bene: Beneficiary) => void
}

type NavId = 'overview' | 'payments' | 'cards' | 'history' | 'investments' | 'agents'

const QUICK_ACTIONS = [
  { icon: '💸', label: 'Send Money',  color: '#4f46e5' },
  { icon: '📊', label: 'Statements',  color: '#0891b2' },
  { icon: '💳', label: 'Cards',       color: '#7c3aed' },
  { icon: '🏦', label: 'FD / RD',     color: '#059669' },
  { icon: '📱', label: 'UPI',         color: '#d97706' },
  { icon: '🔄', label: 'Transfer',    color: '#db2777' },
]

const NAV: { icon: string; label: string; id: NavId }[] = [
  { icon: '⊞',  label: 'Overview',     id: 'overview'     },
  { icon: '↕',  label: 'Payments',     id: 'payments'     },
  { icon: '💳', label: 'Cards',        id: 'cards'        },
  { icon: '🕐', label: 'History',      id: 'history'      },
  { icon: '📈', label: 'Investments',  id: 'investments'  },
  { icon: '🤖', label: 'AI Agents',    id: 'agents'       },
]

interface AgentInfo {
  id: string; name: string; icon: string; domain: string
  description: string; mcp: string; instances: number; healthy: number
  priority: number; identity: string; tools: string[]
}

const AGENT_REGISTRY: AgentInfo[] = [
  {
    id: 'payment_agent_svc', name: 'PaymentOrchestrator', icon: '💳',
    domain: 'PAYMENTS',
    description: 'Handles payment initiation, status tracking, and reconciliation via IMPS.',
    mcp: 'payments-mcp v2.1 · port 3003',
    instances: 3, healthy: 3, priority: 3,
    identity: 'DELEGATED · RFC 8693',
    tools: ['run_aml_screening', 'initiate_payment'],
  },
  {
    id: 'kyc_aml_svc', name: 'KYC/AML Agent', icon: '🪪',
    domain: 'COMPLIANCE',
    description: 'Customer due diligence, sanctions screening, PEP check, AML alert triage.',
    mcp: 'kyc-server',
    instances: 2, healthy: 2, priority: 1,
    identity: 'USER + AGENT COMPOSITE · HIGH SENSITIVITY',
    tools: ['kycStatusTool', 'sanctionsScreenTool', 'pepCheckTool', 'amlAlertTool'],
  },
  {
    id: 'risk_intel_svc', name: 'Risk Intelligence', icon: '📊',
    domain: 'RISK',
    description: 'Real-time credit scoring, fraud detection, and portfolio risk assessment.',
    mcp: 'risk-server',
    instances: 2, healthy: 2, priority: 1,
    identity: 'SERVICE ACCOUNT · SCHEDULED + REALTIME',
    tools: ['riskScoreTool', 'fraudSignalTool'],
  },
  {
    id: 'customer360_svc', name: 'Customer 360', icon: '👤',
    domain: 'CUSTOMER',
    description: 'Account queries, complaints handling, and product recommendations.',
    mcp: 'accounts-server + crm-server',
    instances: 2, healthy: 2, priority: 3,
    identity: 'USER DELEGATED · HUMAN-FACING',
    tools: ['accountSummaryTool', 'customerProfileTool'],
  },
  {
    id: 'treasury_svc', name: 'Treasury Agent', icon: '🏦',
    domain: 'TREASURY',
    description: 'Intraday liquidity, nostro reconciliation, and FX exposure management.',
    mcp: 'treasury-server + fx-server',
    instances: 2, healthy: 2, priority: 2,
    identity: 'MACHINE IDENTITY ONLY · PRIVILEGED SCOPE · FAPI 2.0',
    tools: ['liquidityTool', 'fxExposureTool'],
  },
]

const DOMAIN_COLORS: Record<string, string> = {
  PAYMENTS: '#4f46e5', COMPLIANCE: '#dc2626', RISK: '#d97706',
  CUSTOMER: '#0891b2', TREASURY: '#059669',
}

const NOTIFICATIONS = [
  { id: 1, icon: '💸', title: 'Payment Received', body: 'Salary Credit ₹85,000 from Employer', time: '2h ago', unread: true },
  { id: 2, icon: '🔒', title: 'Security Alert', body: 'New device login detected — Chrome on Mac', time: '5h ago', unread: true },
  { id: 3, icon: '📊', title: 'Monthly Statement', body: 'Your December statement is ready', time: '1d ago', unread: false },
]

const TX_META: Record<string, { icon: string; bg: string }> = {
  'Netflix':       { icon: 'N', bg: '#e50914' },
  'Salary Credit': { icon: '₹', bg: '#16a34a' },
  'Swiggy':        { icon: 'S', bg: '#fc8019' },
  'Amazon':        { icon: 'A', bg: '#ff9900' },
  'Default':       { icon: '•', bg: '#6366f1' },
}

function txMeta(desc: string) {
  return TX_META[desc] ?? TX_META.Default
}

function Skeleton({ w, h, r = 6, style }: { w: string; h: number; r?: number; style?: React.CSSProperties }) {
  return (
    <span
      className="skeleton"
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Transactions table (reused across overview and history views) ─────────────
function TxnTable({ txns, loading }: { txns: AccountData['recentTransactions']; loading: boolean }) {
  return (
    <div className="ba-txn-table">
      <div className="ba-txn-thead">
        <span>Merchant</span><span>Category</span><span>Date</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
      </div>
      {loading ? (
        [1, 2, 3].map((i) => (
          <div key={i} className="ba-txn-row">
            <div className="ba-txn-merchant">
              <Skeleton w="36px" h={36} r={10} /><Skeleton w="100px" h={16} />
            </div>
            <Skeleton w="70px" h={14} /><Skeleton w="70px" h={14} />
            <Skeleton w="60px" h={16} style={{ marginLeft: 'auto' }} />
          </div>
        ))
      ) : (
        txns.map((tx, i) => {
          const meta = txMeta(tx.desc)
          return (
            <div key={i} className="ba-txn-row">
              <div className="ba-txn-merchant">
                <div className="ba-txn-icon" style={{ background: meta.bg }}>{meta.icon}</div>
                <span className="ba-txn-name">{tx.desc}</span>
              </div>
              <span className="ba-txn-cat">{tx.category}</span>
              <span className="ba-txn-date">
                {new Date(tx.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
              <span className={`ba-txn-amount ${tx.type}`}>
                {tx.type === 'credit' ? '+' : '-'}₹{Math.abs(tx.amount).toLocaleString('en-IN')}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

export default function BankingApp({
  data, loading,
  appView, payStatus, payResult, payBene, intentReady,
  onSendMoney, onPayBack, onPay,
}: Props) {
  const firstName = data?.userName?.split(' ')[0] ?? 'there'
  const initials  = data?.userName?.split(' ').map((w: string) => w[0]).join('') ?? '—'

  const [activeNav, setActiveNav]   = useState<NavId>('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAllTx, setShowAllTx]   = useState(false)
  const [showBell, setShowBell]     = useState(false)
  const [orchStats, setOrchStats]   = useState<{ requests_per_min: number; avg_routing_ms: number; p99_routing_ms: number; total_routed_24h: number } | null>(null)
  const [payPreset, setPayPreset]   = useState<{ amount: number; note: string; beneIdx?: number } | null>(null)
  const [runningScenario, setRunningScenario] = useState<string | null>(null)
  const [scenarioResult, setScenarioResult]   = useState<{ id: string; lines: string[] } | null>(null)

  useEffect(() => {
    if (activeNav !== 'agents') return
    fetch('https://localhost:3001/orchestrator/dashboard', { credentials: 'include' })
      .then(r => r.json()).then(setOrchStats).catch(() => null)
  }, [activeNav])

  async function handleScenario(id: string, opts: { amount?: number; note?: string; beneIdx?: number; nav?: NavId; fetchUrl?: string }) {
    if (opts.nav) { setActiveNav(opts.nav); return }
    if (opts.amount !== undefined) {
      setPayPreset({ amount: opts.amount, note: opts.note ?? '', beneIdx: opts.beneIdx ?? 0 })
      onSendMoney()
      return
    }
    if (opts.fetchUrl) {
      setRunningScenario(id)
      setScenarioResult(null)
      try {
        const res  = await fetch(opts.fetchUrl, { credentials: 'include' })
        const json = await res.json() as Record<string, unknown>
        const lines = Object.entries(json).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        setScenarioResult({ id, lines })
      } catch {
        setScenarioResult({ id, lines: ['⚠ Server not reachable — start the backend first'] })
      }
      setRunningScenario(null)
    }
  }

  // Filter and limit transactions
  const allTx = data?.recentTransactions ?? []
  const filteredTx = searchQuery
    ? allTx.filter(tx =>
        tx.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allTx
  const displayedTx = showAllTx ? filteredTx : filteredTx.slice(0, 3)

  function handleQuickAction(label: string) {
    if (label === 'Send Money' || label === 'Transfer') { onSendMoney(); return }
    if (label === 'Statements') { setActiveNav('history'); return }
    if (label === 'Cards')      { setActiveNav('cards');   return }
    if (label === 'FD / RD')    { setActiveNav('investments'); return }
    if (label === 'UPI')        { onSendMoney(); return }  // UPI uses same payment flow
  }

  function handleNavChange(id: NavId) {
    if (id === 'payments') { onSendMoney(); return }
    setActiveNav(id)
  }

  return (
    <div className="ba-root">
      {/* ── Sidebar ── */}
      <aside className="ba-sidebar">
        <div className="ba-logo">
          <span className="ba-logo-mark">B</span>
          <span className="ba-logo-name">BankApp</span>
        </div>

        <nav className="ba-nav">
          {NAV.map(({ icon, label, id }) => (
            <button
              key={id}
              className={`ba-nav-item ${activeNav === id && appView !== 'payment' ? 'active' : ''}`}
              onClick={() => handleNavChange(id)}
            >
              <span className="ba-nav-icon">{icon}</span>
              <span className="ba-nav-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="ba-sidebar-footer">
          <div className="ba-user-chip">
            <div className="ba-avatar-sm">{initials}</div>
            <div className="ba-user-info">
              <span className="ba-user-name">{data?.userName ?? '—'}</span>
              <span className="ba-user-role">Personal</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="ba-main">
        {/* Top bar */}
        <header className="ba-topbar">
          <div className="ba-topbar-left">
            <span className="ba-greeting">{getGreeting()}, {firstName} 👋</span>
            <span className="ba-date">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>
          <div className="ba-topbar-right">
            <div className="ba-search">
              <span className="ba-search-icon">⌕</span>
              <input
                placeholder="Search transactions…"
                className="ba-search-input"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setActiveNav('overview'); setShowAllTx(true) }}
              />
            </div>
            <button className="ba-bell" onClick={() => setShowBell(v => !v)}>
              🔔{NOTIFICATIONS.some(n => n.unread) && <span className="ba-bell-badge">2</span>}
            </button>
            <div className="ba-avatar-lg">{initials}</div>
          </div>
        </header>

        {/* Notification panel */}
        {showBell && (
          <div className="ba-notif-panel">
            <div className="ba-notif-header">
              <span className="ba-notif-title">Notifications</span>
              <button className="ba-notif-close" onClick={() => setShowBell(false)}>✕</button>
            </div>
            {NOTIFICATIONS.map(n => (
              <div key={n.id} className={`ba-notif-item ${n.unread ? 'unread' : ''}`}>
                <span className="ba-notif-icon">{n.icon}</span>
                <div className="ba-notif-body">
                  <div className="ba-notif-item-title">{n.title}</div>
                  <div className="ba-notif-item-body">{n.body}</div>
                  <div className="ba-notif-item-time">{n.time}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Trust bar */}
        <div className="ba-trust-bar">
          <span className="ba-trust-dot" />
          <span>
            {data ? `${data.userName} · Logged in · Device trusted · TLS 1.3` : 'Authenticating…'}
          </span>
          {data && <span className="ba-tls-chip">TLS 1.3 ✓</span>}
        </div>

        {appView === 'payment' ? (
          <PaymentView
            onBack={() => { setPayPreset(null); onPayBack() }}
            onPay={onPay}
            payStatus={payStatus}
            payResult={payResult}
            payBene={payBene}
            intentReady={intentReady}
            initialAmount={payPreset?.amount}
            initialNote={payPreset?.note}
            initialBeneIdx={payPreset?.beneIdx}
          />
        ) : activeNav === 'cards' ? (
          /* ── Cards view ── */
          <div className="ba-content">
            <div className="ba-section">
              <div className="ba-section-header">
                <span className="ba-section-title">Your Cards & Accounts</span>
                <button className="ba-see-all" onClick={() => setActiveNav('overview')}>← Overview</button>
              </div>
              {loading || !data ? (
                <div className="ba-cards-row">
                  <div className="ba-card ba-card-secondary"><Skeleton w="80%" h={18} /><Skeleton w="60%" h={32} r={8} style={{ marginTop: 12 }} /></div>
                </div>
              ) : (
                <div className="ba-cards-row">
                  {data.accounts.map(acc => (
                    <div key={acc.last4} className="ba-card ba-card-primary" style={{ minWidth: 220 }}>
                      <div className="ba-card-label">{acc.type === 'savings' ? '🏦 Savings Account' : '💼 Current Account'}</div>
                      <div className="ba-card-amount">
                        <span className="ba-card-currency">₹</span>
                        {acc.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </div>
                      <div className="ba-card-acct" style={{ marginTop: 8 }}>····{acc.last4}</div>
                      <div className={`ba-card-status ${acc.status}`} style={{ marginTop: 4 }}>{acc.status}</div>
                      <div style={{ marginTop: 12, fontSize: '0.75rem', opacity: 0.7 }}>
                        Visa Debit · Contactless · NFC enabled
                      </div>
                      <span className="ba-blob ba-blob-1" /><span className="ba-blob ba-blob-2" />
                    </div>
                  ))}
                  <div className="ba-card ba-card-secondary" style={{ cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <div style={{ fontSize: '2rem' }}>+</div>
                    <div className="ba-card-label">Add New Card</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeNav === 'history' ? (
          /* ── History view ── */
          <div className="ba-content">
            <div className="ba-section">
              <div className="ba-section-header">
                <span className="ba-section-title">Transaction History</span>
                <button className="ba-see-all" onClick={() => setActiveNav('overview')}>← Overview</button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <input
                  className="ba-search-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #21262d', background: '#0d1117', color: '#c9d1d9' }}
                  placeholder="Filter by merchant or category…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              {loading || !data ? (
                <TxnTable txns={[]} loading={true} />
              ) : (
                <TxnTable txns={filteredTx} loading={false} />
              )}
            </div>
          </div>
        ) : activeNav === 'agents' ? (
          /* ── AI Agents view ── */
          <div className="ba-content">
            {/* Header */}
            <div className="ba-section">
              <div className="ba-section-header">
                <span className="ba-section-title">AI Agent Platform</span>
                <button className="ba-see-all" onClick={() => setActiveNav('overview')}>← Overview</button>
              </div>

              {/* Orchestrator stats bar */}
              <div className="ba-agent-stats-bar">
                <div className="ba-agent-stat">
                  <span className="ba-agent-stat-val">5</span>
                  <span className="ba-agent-stat-label">Agents Registered</span>
                </div>
                <div className="ba-agent-stat">
                  <span className="ba-agent-stat-val">11</span>
                  <span className="ba-agent-stat-label">Total Instances</span>
                </div>
                <div className="ba-agent-stat">
                  <span className="ba-agent-stat-val">{orchStats?.avg_routing_ms ?? '—'}<span style={{ fontSize: '0.7rem' }}>ms</span></span>
                  <span className="ba-agent-stat-label">Avg Routing</span>
                </div>
                <div className="ba-agent-stat">
                  <span className="ba-agent-stat-val">{orchStats?.total_routed_24h ?? '—'}</span>
                  <span className="ba-agent-stat-label">Routed 24h</span>
                </div>
                <div className="ba-agent-stat">
                  <span className="ba-agent-stat-val" style={{ color: '#22c55e' }}>All Healthy</span>
                  <span className="ba-agent-stat-label">Platform Status</span>
                </div>
              </div>

              {/* MCP badge */}
              <div className="ba-mcp-banner">
                <span className="ba-mcp-icon">⬡</span>
                <div>
                  <div className="ba-mcp-title">payments-mcp v2.1 · Model Context Protocol Server · port 3003</div>
                  <div className="ba-mcp-sub">Exposes 2 tools to PaymentOrchestrator · Per-tool OPA enforcement · RASP monitoring · JTI replay prevention · Redis AML cache (1h TTL)</div>
                </div>
                <span className="ba-mcp-status">ONLINE</span>
              </div>

              {/* Routing flow */}
              <div className="ba-flow-row">
                <div className="ba-flow-node ba-flow-node-user">User Intent</div>
                <span className="ba-flow-arrow">→</span>
                <div className="ba-flow-node ba-flow-node-orch">Orchestrator</div>
                <span className="ba-flow-arrow">→</span>
                <div className="ba-flow-node ba-flow-node-judge">Judge LLM</div>
                <span className="ba-flow-arrow">→</span>
                <div className="ba-flow-node ba-flow-node-opa">OPA Gate</div>
                <span className="ba-flow-arrow">→</span>
                <div className="ba-flow-node ba-flow-node-agent">Agent + MCP</div>
                <span className="ba-flow-arrow">→</span>
                <div className="ba-flow-node ba-flow-node-cbs">CBS / Ledger</div>
              </div>
            </div>

            {/* Agent cards */}
            <div className="ba-section">
              <div className="ba-section-header">
                <span className="ba-section-title">Registered Agents</span>
              </div>
              <div className="ba-agent-grid">
                {AGENT_REGISTRY.map(agent => (
                  <div key={agent.id} className="ba-agent-card">
                    <div className="ba-agent-card-top">
                      <div
                        className="ba-agent-icon-wrap"
                        style={{ background: DOMAIN_COLORS[agent.domain] + '18', border: `1.5px solid ${DOMAIN_COLORS[agent.domain]}33` }}
                      >
                        <span style={{ fontSize: '1.5rem' }}>{agent.icon}</span>
                      </div>
                      <div className="ba-agent-meta">
                        <span className="ba-agent-name">{agent.name}</span>
                        <span
                          className="ba-agent-domain"
                          style={{ background: DOMAIN_COLORS[agent.domain] + '18', color: DOMAIN_COLORS[agent.domain] }}
                        >
                          {agent.domain}
                        </span>
                      </div>
                      <div className="ba-agent-health">
                        <span className="ba-agent-health-dot" />
                        <span className="ba-agent-health-label">{agent.healthy}/{agent.instances}</span>
                      </div>
                    </div>

                    <p className="ba-agent-desc">{agent.description}</p>

                    <div className="ba-agent-tools">
                      {agent.tools.map(t => (
                        <span key={t} className="ba-tool-chip">{t}</span>
                      ))}
                    </div>

                    <div className="ba-agent-footer">
                      <div className="ba-agent-footer-row">
                        <span className="ba-agent-footer-label">MCP</span>
                        <span className="ba-agent-footer-val">{agent.mcp}</span>
                      </div>
                      <div className="ba-agent-footer-row">
                        <span className="ba-agent-footer-label">Identity</span>
                        <span className="ba-agent-footer-val">{agent.identity}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* User Scenarios */}
            <div className="ba-section">
              <div className="ba-section-header">
                <span className="ba-section-title">When is each agent called?</span>
              </div>
              <div className="ba-scenario-grid">
                {([
                  {
                    id: 'pay-rent',
                    emoji: '💸', action: 'Send ₹25,000 for rent',
                    body: 'Opens the real payment flow pre-filled. Runs AML screening + CBS debit via MCP.',
                    steps: ['Orchestrator → PaymentOrchestrator', 'MCP: run_aml_screening', 'MCP: initiate_payment → CBS debit'],
                    agent: 'PaymentOrchestrator', color: '#4f46e5',
                    trigger: { amount: 25000, note: 'Rent payment', beneIdx: 0 },
                    btnLabel: '▶ Pay Now',
                  },
                  {
                    id: 'kyc',
                    emoji: '🪪', action: 'Open a new savings account',
                    body: 'Hits the live orchestrator dashboard — shows real routing stats from the KYC/AML agent.',
                    steps: ['KYC/AML Agent activated', 'kycStatusTool → verify documents', 'sanctionsScreenTool + pepCheckTool', 'amlAlertTool → clear/flag'],
                    agent: 'KYC/AML Agent', color: '#dc2626',
                    trigger: { fetchUrl: 'https://localhost:3001/orchestrator/dashboard' },
                    btnLabel: '▶ Run KYC Check',
                  },
                  {
                    id: 'large-transfer',
                    emoji: '⚠️', action: 'Large transfer ₹4,00,000',
                    body: 'Opens payment flow with ₹4L. Judge LLM classifies as Tier C → blocks (requires human review).',
                    steps: ['Orchestrator routes → PaymentOrchestrator', 'Judge LLM → Tier C (> ₹2L)', 'OPA: amount_autonomous FAILS', 'Returns blocked — no CBS debit'],
                    agent: 'Risk Intelligence', color: '#d97706',
                    trigger: { amount: 400000, note: 'Property purchase down payment', beneIdx: 5 },
                    btnLabel: '▶ Try Transfer',
                  },
                  {
                    id: 'account-summary',
                    emoji: '👤', action: 'View account summary',
                    body: 'Navigates to the Overview — shows real live account balance and recent transactions.',
                    steps: ['Customer360 Agent selected', 'accountSummaryTool → live balances', 'customerProfileTool → segment + offers'],
                    agent: 'Customer 360', color: '#0891b2',
                    trigger: { nav: 'overview' as NavId },
                    btnLabel: '▶ View Account',
                  },
                  {
                    id: 'treasury',
                    emoji: '🏦', action: 'End-of-day settlement run',
                    body: 'Fetches live orchestrator stats — shows real req/min, routing latency, and agent health.',
                    steps: ['Treasury Agent triggered (CRON)', 'liquidityTool → intraday LCR', 'fxExposureTool → open positions'],
                    agent: 'Treasury Agent', color: '#059669',
                    trigger: { fetchUrl: 'https://localhost:3001/orchestrator/dashboard' },
                    btnLabel: '▶ Run Settlement',
                  },
                  {
                    id: 'duplicate',
                    emoji: '🔄', action: 'Duplicate payment detected',
                    body: 'Opens payment with same ₹25K + Rahul. Submit twice — second one is blocked by WAL idempotency key.',
                    steps: ['WAL idempotency key matched', 'Judge LLM: duplicate pattern', 'OPA: not_duplicate FAILS', '409 returned — no CBS debit'],
                    agent: 'PaymentOrchestrator', color: '#4f46e5',
                    trigger: { amount: 25000, note: 'Rent payment', beneIdx: 0 },
                    btnLabel: '▶ Simulate Duplicate',
                  },
                ] as const).map(sc => {
                  const isRunning = runningScenario === sc.id
                  const result    = scenarioResult?.id === sc.id ? scenarioResult.lines : null
                  return (
                    <div key={sc.id} className="ba-scenario-card">
                      <div className="ba-scenario-trigger">
                        <span className="ba-scenario-emoji">{sc.emoji}</span>
                        <span className="ba-scenario-action">{sc.action}</span>
                      </div>
                      <p className="ba-scenario-body">{sc.body}</p>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {sc.steps.map((s, i) => (
                          <div key={i} className="ba-scenario-arrow-row">
                            <span className="ba-scenario-arrow">{i === 0 ? '▶' : '→'}</span>
                            <span>{s}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <div
                          className="ba-scenario-agent-tag"
                          style={{ background: sc.color + '15', color: sc.color, border: `1px solid ${sc.color}30` }}
                        >
                          <span>🤖</span><span>{sc.agent}</span>
                        </div>
                        <button
                          className="ba-scenario-run-btn"
                          style={{ borderColor: sc.color, color: sc.color }}
                          disabled={isRunning}
                          onClick={() => handleScenario(sc.id, 'trigger' in sc ? (sc.trigger as Parameters<typeof handleScenario>[1]) : {})}
                        >
                          {isRunning ? '⏳ Running…' : sc.btnLabel}
                        </button>
                      </div>

                      {result && (
                        <div className="ba-scenario-result">
                          {result.map((line, i) => <div key={i} className="ba-scenario-result-line">{line}</div>)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : activeNav === 'investments' ? (
          /* ── Investments / FD-RD view ── */
          <div className="ba-content">
            <div className="ba-section">
              <div className="ba-section-header">
                <span className="ba-section-title">Investments & Deposits</span>
                <button className="ba-see-all" onClick={() => setActiveNav('overview')}>← Overview</button>
              </div>
              <div className="ba-cards-row">
                {[
                  { label: 'Fixed Deposit', amount: '2,00,000', rate: '7.1%', maturity: 'Mar 2026', color: '#059669' },
                  { label: 'Recurring Deposit', amount: '5,000/mo', rate: '6.8%', maturity: 'Dec 2025', color: '#0891b2' },
                  { label: 'Mutual Fund SIP', amount: '10,000/mo', rate: '+12.4% YTD', maturity: 'Ongoing', color: '#7c3aed' },
                ].map(item => (
                  <div key={item.label} className="ba-card ba-card-secondary" style={{ cursor: 'pointer' }}>
                    <div className="ba-card-label">{item.label}</div>
                    <div className="ba-card-amount-sm" style={{ color: item.color }}>₹{item.amount}</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 4 }}>Rate: {item.rate}</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>Maturity: {item.maturity}</div>
                  </div>
                ))}
                <div className="ba-card ba-card-secondary" style={{ cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <div style={{ fontSize: '2rem' }}>+</div>
                  <div className="ba-card-label">New Investment</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
        /* ── Overview (default) ── */
        <div className="ba-content">
          {/* ── Balance cards ── */}
          <div className="ba-cards-row">
            <div className="ba-card ba-card-primary">
              <div className="ba-card-label">Total Balance</div>
              {loading || !data ? (
                <div style={{ marginTop: 8 }}><Skeleton w="160px" h={40} r={8} /></div>
              ) : (
                <div className="ba-card-amount">
                  <span className="ba-card-currency">₹</span>
                  {data.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              )}
              {data && (
                <div className="ba-card-change">
                  <span className="ba-up-arrow">↑</span>{data.monthlyChange}% this month
                </div>
              )}
              <span className="ba-blob ba-blob-1" /><span className="ba-blob ba-blob-2" />
            </div>

            {loading || !data ? (
              <>
                <div className="ba-card ba-card-secondary"><Skeleton w="80%" h={18} /><Skeleton w="60%" h={32} r={8} style={{ marginTop: 12 }} /></div>
                <div className="ba-card ba-card-secondary"><Skeleton w="80%" h={18} /><Skeleton w="60%" h={32} r={8} style={{ marginTop: 12 }} /></div>
              </>
            ) : (
              data.accounts.map((acc) => (
                <div key={acc.last4} className="ba-card ba-card-secondary" onClick={() => setActiveNav('cards')} style={{ cursor: 'pointer' }}>
                  <div className="ba-card-label">{acc.type === 'savings' ? '🏦 Savings' : '💼 Current'}</div>
                  <div className="ba-card-amount-sm">₹{acc.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                  <div className="ba-card-acct">····{acc.last4}</div>
                  <div className={`ba-card-status ${acc.status}`}>{acc.status}</div>
                </div>
              ))
            )}
          </div>

          {/* ── Quick actions ── */}
          <div className="ba-section">
            <div className="ba-section-header">
              <span className="ba-section-title">Quick Actions</span>
            </div>
            <div className="ba-actions-row">
              {QUICK_ACTIONS.map(({ icon, label, color }) => (
                <button
                  key={label}
                  className="ba-action"
                  style={{ '--action-color': color } as React.CSSProperties}
                  onClick={() => handleQuickAction(label)}
                  disabled={label === 'Send Money' && loading}
                >
                  <span className="ba-action-icon">{icon}</span>
                  <span className="ba-action-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Transactions ── */}
          <div className="ba-section">
            <div className="ba-section-header">
              <span className="ba-section-title">Recent Transactions</span>
              <button className="ba-see-all" onClick={() => { setShowAllTx(true); setActiveNav('history') }}>
                View all →
              </button>
            </div>
            <TxnTable txns={displayedTx} loading={loading || !data} />
          </div>
        </div>
        )}
      </main>
    </div>
  )
}
