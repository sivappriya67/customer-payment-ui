import './CustomerView.css'

export interface AccountData {
  userName: string
  balance: number
  currency: string
  monthlyChange: number
  accounts: Array<{ type: string; balance: number; last4: string; status: string }>
  recentTransactions: Array<{
    date: string
    desc: string
    category: string
    amount: number
    type: 'debit' | 'credit'
  }>
}

interface Props {
  data: AccountData
  onBack: () => void
}

const TX_META: Record<string, { icon: string; bg: string }> = {
  Netflix:        { icon: 'N',  bg: '#e50914' },
  'Salary Credit':{ icon: '₹',  bg: '#16a34a' },
  Swiggy:         { icon: 'S',  bg: '#fc8019' },
  Amazon:         { icon: 'A',  bg: '#ff9900' },
  Default:        { icon: '•',  bg: '#6366f1' },
}

function txMeta(desc: string) {
  return TX_META[desc] ?? TX_META.Default
}

function formatINR(n: number): string {
  return Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function getHour(): number {
  return new Date().getHours()
}

function greeting(): string {
  const h = getHour()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const QUICK_ACTIONS = [
  { icon: '💸', label: 'Send Money' },
  { icon: '📊', label: 'Statements' },
  { icon: '💳', label: 'Cards' },
  { icon: '🏦', label: 'FD / RD' },
]

const NAV_ITEMS = [
  { icon: '⊞', label: 'Home',    active: true  },
  { icon: '💳', label: 'Cards',   active: false },
  { icon: '↕',  label: 'Pay',     active: false },
  { icon: '🕐', label: 'History', active: false },
  { icon: '👤', label: 'Profile', active: false },
]

export default function CustomerView({ data, onBack }: Props) {
  const firstName = data.userName.split(' ')[0]
  const initials  = data.userName.split(' ').map((w) => w[0]).join('')
  const now = new Date()
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <div className="cv-page">
      {/* ── Security meta bar ── */}
      <div className="cv-meta-bar">
        <div className="cv-meta-label">
          <span className="cv-meta-title">CUSTOMER VIEW</span>
          <span className="cv-meta-sep">—</span>
          <span className="cv-meta-sub">Banking App (iOS / Android)</span>
        </div>
        <div className="cv-meta-trust">
          <span className="cv-trust-dot" />
          <span>{data.userName}</span>
          <span className="cv-trust-sep">·</span>
          <span>Logged in</span>
          <span className="cv-trust-sep">·</span>
          <span>Device trusted</span>
          <span className="cv-trust-sep">·</span>
          <span className="cv-tls-badge">TLS 1.3</span>
        </div>
      </div>

      {/* ── Phone frame ── */}
      <div className="cv-phone-wrap">
        <div className="cv-phone">
          {/* Dynamic island */}
          <div className="cv-dynamic-island" />

          {/* Status bar */}
          <div className="cv-status-bar">
            <span className="cv-time">{timeStr}</span>
            <div className="cv-status-right">
              <span className="cv-signal">
                <span /><span /><span /><span />
              </span>
              <span className="cv-wifi">▲</span>
              <span className="cv-battery">
                <span className="cv-battery-fill" style={{ width: '87%' }} />
              </span>
              <span className="cv-battery-pct">87%</span>
            </div>
          </div>

          {/* Scrollable app content */}
          <div className="cv-scroll">

            {/* App header */}
            <div className="cv-app-header">
              <div className="cv-avatar">{initials}</div>
              <div className="cv-greeting-block">
                <span className="cv-greeting">{greeting()}, {firstName}</span>
                <span className="cv-app-name">BankApp</span>
              </div>
              <button className="cv-bell" aria-label="Notifications">
                <span className="cv-bell-icon">🔔</span>
                <span className="cv-bell-dot" />
              </button>
            </div>

            {/* Balance card */}
            <div className="cv-balance-card">
              <div className="cv-balance-label">Total Balance</div>
              <div className="cv-balance-amount">
                <span className="cv-currency">₹</span>
                {data.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
              <div className="cv-balance-change">
                <span className="cv-change-arrow">↑</span>
                {data.monthlyChange}% this month
              </div>
              <div className="cv-card-chips">
                {data.accounts.map((acc) => (
                  <span key={acc.last4} className="cv-account-chip">
                    {acc.type === 'savings' ? '🏦' : '💼'} ····{acc.last4}
                  </span>
                ))}
              </div>
              {/* Decorative circles */}
              <span className="cv-blob cv-blob-1" />
              <span className="cv-blob cv-blob-2" />
            </div>

            {/* Quick actions */}
            <div className="cv-section-header">
              <span className="cv-section-title">QUICK ACTIONS</span>
            </div>
            <div className="cv-quick-actions">
              {QUICK_ACTIONS.map(({ icon, label }) => (
                <button key={label} className="cv-action-btn">
                  <span className="cv-action-icon">{icon}</span>
                  <span className="cv-action-label">{label}</span>
                </button>
              ))}
            </div>

            {/* Recent transactions */}
            <div className="cv-section-header">
              <span className="cv-section-title">RECENT TRANSACTIONS</span>
              <button className="cv-see-all">See all →</button>
            </div>
            <div className="cv-txn-list">
              {data.recentTransactions.map((tx, i) => {
                const meta = txMeta(tx.desc)
                const sign = tx.type === 'credit' ? '+' : '-'
                return (
                  <div key={i} className="cv-txn-row">
                    <div
                      className="cv-txn-icon"
                      style={{ background: meta.bg }}
                    >
                      {meta.icon}
                    </div>
                    <div className="cv-txn-info">
                      <span className="cv-txn-name">{tx.desc}</span>
                      <span className="cv-txn-cat">{tx.category}</span>
                    </div>
                    <div className={`cv-txn-amount ${tx.type}`}>
                      {sign}₹{formatINR(tx.amount)}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Spacer for bottom nav */}
            <div style={{ height: 72 }} />
          </div>

          {/* Bottom navigation */}
          <div className="cv-bottom-nav">
            {NAV_ITEMS.map(({ icon, label, active }) => (
              <button key={label} className={`cv-nav-item ${active ? 'active' : ''}`}>
                <span className="cv-nav-icon">{icon}</span>
                <span className="cv-nav-label">{label}</span>
              </button>
            ))}
          </div>

          {/* Home indicator */}
          <div className="cv-home-indicator" />
        </div>

        {/* Back button below phone */}
        <button className="cv-back-btn" onClick={onBack}>
          ← Back to Console
        </button>
      </div>
    </div>
  )
}
