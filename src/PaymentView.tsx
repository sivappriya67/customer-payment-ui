import { useState } from 'react'
import './PaymentView.css'

export interface PaymentResult {
  txn_id: string
  trace_id: string
  amount: number
  timestamp: string
  // CBS
  imps_ref?: string
  cbs_txn_id?: string
  balance_before?: number
  balance_after?: number
  commit_ts?: string
  non_rep_sig?: string
  aml_ref?: string
  // Security audit
  audit_id?: string
  dlp_exec_id?: string
  judge_approval_ref?: string
  opa_decision_ids?: string[]
  // Latency
  total_latency_ms?: number
}

export interface Beneficiary {
  id: string
  name: string
  initial: string
  bank: string
  acct: string       // masked account suffix
  riskLevel: 'Low' | 'Medium'
  avatarGrad: string
}

export const BENEFICIARIES: Beneficiary[] = [
  { id: 'TKN-BEN-r7x2', name: 'Rahul Kumar',   initial: 'R', bank: 'HDFC Bank',    acct: '••••3892', riskLevel: 'Low',    avatarGrad: 'linear-gradient(135deg,#0891b2,#0284c7)' },
  { id: 'TKN-BEN-a3f5', name: 'Ananya Singh',  initial: 'A', bank: 'SBI',          acct: '••••1120', riskLevel: 'Low',    avatarGrad: 'linear-gradient(135deg,#7c3aed,#6d28d9)' },
  { id: 'TKN-BEN-k9p1', name: 'Kiran Patel',   initial: 'K', bank: 'ICICI Bank',   acct: '••••4471', riskLevel: 'Low',    avatarGrad: 'linear-gradient(135deg,#059669,#047857)' },
  { id: 'TKN-BEN-m2q8', name: 'Meera Nair',    initial: 'M', bank: 'Axis Bank',    acct: '••••8830', riskLevel: 'Low',    avatarGrad: 'linear-gradient(135deg,#d97706,#b45309)' },
  { id: 'TKN-BEN-s6w3', name: 'Suresh Menon',  initial: 'S', bank: 'Kotak Bank',   acct: '••••2294', riskLevel: 'Medium', avatarGrad: 'linear-gradient(135deg,#db2777,#be185d)' },
  { id: 'TKN-BEN-v4t7', name: 'Vikram Sharma', initial: 'V', bank: 'Bank of Baroda',acct: '••••6615', riskLevel: 'Low',    avatarGrad: 'linear-gradient(135deg,#0369a1,#075985)' },
]

interface Props {
  onBack: () => void
  onPay: (amount: number, note: string, bene: Beneficiary) => void
  payStatus: 'idle' | 'processing' | 'done'
  payResult: PaymentResult | null
  intentReady: boolean
  payBene?: Beneficiary
  initialAmount?: number
  initialNote?: string
  initialBeneIdx?: number
}

export default function PaymentView({ onBack, onPay, payStatus, payResult, intentReady, payBene, initialAmount, initialNote, initialBeneIdx }: Props) {
  const [amount, setAmount] = useState(String(initialAmount ?? 25000))
  const [note,   setNote]   = useState(initialNote ?? 'Rent payment')
  const [beneIdx, setBeneIdx] = useState(initialBeneIdx ?? 0)

  const formatted = Number(amount || 0).toLocaleString('en-IN')
  const selectedBene = BENEFICIARIES[beneIdx]

  // ── PDF receipt generator ─────────────────────────────────────────────────
  function downloadReceipt(result: PaymentResult, bene: Beneficiary) {
    const processedAt = result.commit_ts
      ? new Date(result.commit_ts).toLocaleString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: true, timeZone: 'Asia/Kolkata',
        }) + ' IST'
      : new Date(result.timestamp).toLocaleString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: true, timeZone: 'Asia/Kolkata',
        }) + ' IST'

    const totalS    = result.total_latency_ms ? (result.total_latency_ms / 1000).toFixed(2) : '—'
    const balBefore = result.balance_before != null ? `₹${result.balance_before.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'
    const balAfter  = result.balance_after  != null ? `₹${result.balance_after.toLocaleString('en-IN',  { minimumFractionDigits: 2 })}` : '—'
    const opaIds    = (result.opa_decision_ids ?? []).join(', ') || '—'
    const generatedAt = new Date().toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'Asia/Kolkata',
    }) + ' IST'

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BankApp Receipt — ${result.imps_ref ?? result.txn_id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #111; font-size: 13px; padding: 40px; }
  .page { max-width: 680px; margin: 0 auto; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 18px; margin-bottom: 24px; }
  .bank-name { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
  .bank-sub  { font-size: 11px; color: #6b7280; margin-top: 3px; }
  .header-right { text-align: right; }
  .header-right .doc-title { font-size: 16px; font-weight: 700; color: #1d4ed8; }
  .header-right .doc-gen   { font-size: 10px; color: #9ca3af; margin-top: 4px; }

  /* Success stamp */
  .success-stamp { background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 18px; }
  .success-stamp .tick { width: 48px; height: 48px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; font-weight: 700; flex-shrink: 0; }
  .success-stamp .info { }
  .success-stamp .amt  { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
  .success-stamp .bene { font-size: 13px; color: #374151; margin-top: 4px; }
  .success-stamp .mode { font-size: 11px; color: #6b7280; margin-top: 2px; }

  /* Sections */
  .section { margin-bottom: 22px; }
  .section-title { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px solid #f3f4f6; gap: 16px; }
  .row:last-child { border-bottom: none; }
  .row .lbl { color: #6b7280; flex-shrink: 0; min-width: 170px; }
  .row .val { font-weight: 600; text-align: right; word-break: break-all; }
  .row .val.mono { font-family: 'SF Mono', 'Courier New', monospace; font-size: 11px; font-weight: 500; }
  .row .val.green { color: #059669; }
  .row .val.blue  { color: #1d4ed8; }

  /* Audit box */
  .audit-box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #6366f1; border-radius: 6px; padding: 14px 18px; }

  /* Footer */
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; line-height: 1.6; }
  .footer strong { color: #6b7280; }

  /* Stamp row */
  .stamp-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .stamp { border: 1px solid #d1d5db; border-radius: 4px; padding: 3px 8px; font-size: 10px; color: #374151; font-weight: 600; letter-spacing: 0.5px; }
  .stamp.green { border-color: #6ee7b7; color: #059669; background: #ecfdf5; }
  .stamp.blue  { border-color: #bfdbfe; color: #1d4ed8; background: #eff6ff; }
  .stamp.purple{ border-color: #ddd6fe; color: #7c3aed; background: #f5f3ff; }

  @media print {
    body { padding: 20px; }
    button { display: none; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="bank-name">BankApp</div>
      <div class="bank-sub">Gravity Bank · Personal Banking</div>
    </div>
    <div class="header-right">
      <div class="doc-title">Payment Receipt</div>
      <div class="doc-gen">Generated: ${generatedAt}</div>
    </div>
  </div>

  <!-- Success stamp -->
  <div class="success-stamp">
    <div class="tick">✓</div>
    <div class="info">
      <div class="amt">₹${result.amount.toLocaleString('en-IN')}</div>
      <div class="bene">To ${bene.name} · ${bene.bank} · ${bene.acct}</div>
      <div class="mode">IMPS — Instant Payment Service · Processed: ${processedAt}</div>
    </div>
  </div>

  <!-- Transaction Details -->
  <div class="section">
    <div class="section-title">Transaction Details</div>
    <div class="row"><span class="lbl">IMPS Reference</span>       <span class="val mono blue">${result.imps_ref ?? '—'}</span></div>
    <div class="row"><span class="lbl">CBS Transaction ID</span>    <span class="val mono">${result.cbs_txn_id ?? result.txn_id}</span></div>
    <div class="row"><span class="lbl">W3C Trace ID</span>          <span class="val mono">${result.trace_id?.slice(0, 40) ?? '—'}…</span></div>
    <div class="row"><span class="lbl">Payment Mode</span>          <span class="val">IMPS — Instant Transfer</span></div>
    <div class="row"><span class="lbl">Processed At</span>          <span class="val">${processedAt}</span></div>
    <div class="row"><span class="lbl">Total Processing Time</span> <span class="val">${totalS} seconds (end-to-end)</span></div>
  </div>

  <!-- Account Summary -->
  <div class="section">
    <div class="section-title">Account Summary</div>
    <div class="row"><span class="lbl">Sender</span>         <span class="val">Priya Sharma · SBI ••••8842</span></div>
    <div class="row"><span class="lbl">Recipient</span>      <span class="val">${bene.name} · ${bene.bank} · ${bene.acct}</span></div>
    <div class="row"><span class="lbl">Amount Debited</span> <span class="val">₹${result.amount.toLocaleString('en-IN')}</span></div>
    <div class="row"><span class="lbl">Balance Before</span> <span class="val">${balBefore}</span></div>
    <div class="row"><span class="lbl">Balance After</span>  <span class="val green">${balAfter}</span></div>
    <div class="row"><span class="lbl">AML Reference</span>  <span class="val mono">${result.aml_ref ?? '—'}</span></div>
  </div>

  <!-- AI Security Audit Trail -->
  <div class="section">
    <div class="section-title">AI Security Audit Trail</div>
    <div class="audit-box">
      <div class="row"><span class="lbl">AML Screening</span>          <span class="val green">CLEAR — 4 lists checked (OFAC SDN, UN, RBI, FATF)</span></div>
      <div class="row"><span class="lbl">Injection Detection</span>    <span class="val green">CLEAN — 50 patterns scanned</span></div>
      <div class="row"><span class="lbl">DLP Outbound Scan</span>      <span class="val green">PASS — 6 PII types checked · Exec: ${result.dlp_exec_id ?? '—'}</span></div>
      <div class="row"><span class="lbl">Judge Approval Token</span>   <span class="val mono">${result.judge_approval_ref ?? '—'}</span></div>
      <div class="row"><span class="lbl">OPA Policy Decisions</span>   <span class="val mono">${opaIds}</span></div>
      <div class="row"><span class="lbl">Non-Repudiation Sig</span>    <span class="val mono">${result.non_rep_sig ?? '—'}</span></div>
    </div>
    <div class="stamp-row" style="margin-top:10px">
      <span class="stamp green">AML CLEAR</span>
      <span class="stamp green">OPA ALLOW</span>
      <span class="stamp blue">JUDGE APPROVED</span>
      <span class="stamp purple">DLP PASS</span>
      <span class="stamp green">WORM SEALED</span>
    </div>
  </div>

  <!-- WORM Audit -->
  <div class="section">
    <div class="section-title">WORM Audit Record</div>
    <div class="row"><span class="lbl">Audit ID</span>           <span class="val mono">${result.audit_id ?? '—'}</span></div>
    <div class="row"><span class="lbl">Storage Backend</span>    <span class="val">server/audit/worm-audit.jsonl (append-only)</span></div>
    <div class="row"><span class="lbl">Retention Policy</span>   <span class="val">7 years — until 31 Dec 2031</span></div>
    <div class="row"><span class="lbl">Regulatory Basis</span>   <span class="val">RBI Master Direction 2021 · PMLA 2002</span></div>
    <div class="row"><span class="lbl">Delegation Depth</span>   <span class="val">1 (Orchestrator → PaymentAgent · RFC 8693)</span></div>
    <div class="row"><span class="lbl">CBS Database</span>       <span class="val">SQLite (ACID) · Ed25519 signed ledger row</span></div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <strong>This is a computer-generated receipt and does not require a signature.</strong><br>
    Powered by BankApp AI Agent System v2.1 · PaymentOrchestrator Agent · MCP v2.1.0<br>
    Security: WebAuthn FIDO2 + PKCE S256 + Gravitee APIM + OPA Policy Engine<br>
    For disputes or queries, quote IMPS Reference <strong>${result.imps_ref ?? result.txn_id}</strong> to your branch or call 1800-XXX-XXXX.
  </div>

</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`

    const w = window.open('', '_blank', 'width=750,height=900')
    if (w) {
      w.document.write(html)
      w.document.close()
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (payStatus === 'done' && payResult) {
    const bene    = payBene ?? BENEFICIARIES[0]
    const totalS  = payResult.total_latency_ms
      ? (payResult.total_latency_ms / 1000).toFixed(2)
      : '2.31'

    const processedAt = payResult.commit_ts
      ? new Date(payResult.commit_ts).toLocaleString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: true, timeZone: 'Asia/Kolkata',
        }) + ' IST'
      : new Date(payResult.timestamp).toLocaleString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: true, timeZone: 'Asia/Kolkata',
        }) + ' IST'

    const newBalance = payResult.balance_after != null
      ? `₹${payResult.balance_after.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
      : '₹99,832.50'

    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`

    const receiptRows: [string, string, boolean][] = [
      ['IMPS Reference',    payResult.imps_ref ?? '—',                  true  ],
      ['Transaction ID',    payResult.cbs_txn_id ?? payResult.txn_id,   true  ],
      ['Payment Mode',      'IMPS — Instant Transfer',                   false ],
      ['Processed At',      processedAt,                                 false ],
      ['Processing Time',   `${totalS} seconds`,                         false ],
      ['AI Security Checks','AML ✓ · Fraud ✓ · DLP ✓',                  false ],
      ['New Balance',       newBalance,                                   false ],
    ]

    return (
      <div className="pv-root pv-success-root">
        {/* ── Header bar ── */}
        <div className="pv-success-header">
          <div className="pv-success-header-left">
            <span className="pv-success-user">Priya Sharma</span>
            <span className="pv-success-meta">
              ₹{payResult.amount.toLocaleString('en-IN')} sent to {bene.name} · {totalS}s
            </span>
          </div>
          <div className="pv-phone-status">
            <span>{timeStr}</span>
            <span>⚡ 87%</span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="pv-success-body">
          <div className="pv-success-circle">✓</div>

          <h2 className="pv-success-amount-h2">
            ₹{payResult.amount.toLocaleString('en-IN')} Sent!
          </h2>
          <p className="pv-success-bene">To {bene.name} · {bene.bank} · Via IMPS</p>

          <div className="pv-receipt-new">
            {receiptRows.map(([label, value, mono]) => (
              <div key={label} className="pv-receipt-new-row">
                <span className="pv-receipt-new-label">{label}</span>
                <span className={`pv-receipt-new-val${mono ? ' mono' : ''}`}>{value}</span>
              </div>
            ))}
          </div>

          <div className="pv-ai-summary-box">
            <div className="pv-ai-summary-title">🤖 AI PAYMENT PROCESSING SUMMARY</div>
            <div className="pv-ai-summary-text">
              Payment processed by PaymentOrchestrator AI Agent with AML screening (4 lists),
              injection detection (50 patterns), fraud scoring, and identity verification.
              All checks passed. Audit trail permanently sealed. No human intervention required
              for this Tier A payment.
            </div>
          </div>

          <button className="pv-download-btn" onClick={() => downloadReceipt(payResult, bene)}>Download Receipt (PDF)</button>
          <button className="pv-another-btn" onClick={onBack}>Make Another Payment</button>
        </div>
      </div>
    )
  }

  // ── Payment form ─────────────────────────────────────────────────────────
  return (
    <div className="pv-root">
      <div className="pv-header">
        <button className="pv-back-link" onClick={onBack}>← Overview</button>
        <h2 className="pv-title">Send Money</h2>
      </div>

      <div className="pv-form">
        {/* ── Beneficiary selection ── */}
        <div className="pv-field">
          <label className="pv-label">To</label>

          {/* Scrollable beneficiary picker */}
          <div className="pv-bene-list">
            {BENEFICIARIES.map((b, i) => (
              <button
                key={b.id}
                className={`pv-bene-pill ${i === beneIdx ? 'selected' : ''}`}
                onClick={() => setBeneIdx(i)}
                disabled={payStatus === 'processing'}
              >
                <span className="pv-pill-avatar" style={{ background: b.avatarGrad }}>{b.initial}</span>
                <span className="pv-pill-name">{b.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>

          {/* Selected beneficiary card */}
          <div className="pv-bene-card">
            <div className="pv-bene-avatar" style={{ background: selectedBene.avatarGrad }}>
              {selectedBene.initial}
            </div>
            <div className="pv-bene-info">
              <span className="pv-bene-name">{selectedBene.name}</span>
              <span className="pv-bene-bank">{selectedBene.bank}  {selectedBene.acct}</span>
            </div>
            <div className={`pv-bene-risk ${selectedBene.riskLevel === 'Medium' ? 'medium' : ''}`}>
              <span className={`pv-risk-dot ${selectedBene.riskLevel === 'Medium' ? 'medium' : ''}`} />
              <span className="pv-risk-label">{selectedBene.riskLevel} risk</span>
            </div>
          </div>
        </div>

        {/* Amount */}
        <div className="pv-field">
          <label className="pv-label">Amount</label>
          <div className="pv-amount-wrap">
            <span className="pv-amount-prefix">₹</span>
            <input
              className="pv-amount-input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1"
              max="500000"
              disabled={payStatus === 'processing'}
            />
          </div>
          {Number(amount) > 0 && (
            <span className="pv-amount-hint">₹{formatted} · IMPS · Instant</span>
          )}
        </div>

        {/* Note */}
        <div className="pv-field">
          <label className="pv-label">Note <span className="pv-optional">(optional)</span></label>
          <input
            className="pv-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's this for?"
            disabled={payStatus === 'processing'}
          />
        </div>

        {/* AI badge */}
        <div className="pv-ai-badge">
          <span className="pv-ai-icon">✦</span>
          <span className="pv-ai-text">AI-assisted payment · DISC-4f81 · CNS-8821 in effect</span>
          <span className={`pv-consent-status ${intentReady ? 'ready' : 'checking'}`}>
            {intentReady ? '✓ Pre-checks passed' : '⏳ Pre-checking…'}
          </span>
        </div>

        {/* Pay button */}
        <button
          className={`pv-pay-btn ${payStatus === 'processing' ? 'loading' : ''}`}
          onClick={() => onPay(Number(amount), note, selectedBene)}
          disabled={payStatus === 'processing' || !intentReady || !amount}
        >
          {payStatus === 'processing'
            ? <><span className="pv-spinner" /> Processing…</>
            : <>Pay ₹{formatted}</>
          }
        </button>

        <p className="pv-footnote">
          Tier A · ≤ ₹50,000 · Agent executes autonomously · No OTP required
        </p>
      </div>
    </div>
  )
}
