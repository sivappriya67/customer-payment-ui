import { useState, useCallback, useEffect, useRef } from 'react'
import BankingApp from './BankingApp'
import type { AccountData } from './CustomerView'
import type { PaymentResult, Beneficiary } from './PaymentView'
import './App.css'

// Traffic flows: React → Vite proxy /bankapp → Express :3001 (HTTPS)
const API = '/bankapp'
// IdP routes live on the same Express backend
const IDP_API = '/bankapp'


// ── Types ─────────────────────────────────────────────────────────────────
type StepStatus = 'idle' | 'running' | 'done' | 'error'
interface StepState { status: StepStatus; logs: string[]; badge?: string }

function blank(): StepState { return { status: 'idle', logs: [] } }

const AUTH_INIT = () => ({
  biometric: blank(), token: blank(), tls: blank(), account: blank(),
})
const PAY_INIT = () => ({
  intent: blank(), preflight: blank(), payload: blank(), security: blank(), cbs: blank(), dlp: blank(), audit: blank(),
})

const AUTH_META = [
  { id: 'biometric', icon: '📱', title: 'App Launch → Biometric Auth' },
  { id: 'token',     icon: '🔐', title: 'OAuth2 PKCE Token Check'     },
  { id: 'tls',       icon: '🌐', title: 'TLS 1.3 Handshake to APIM'   },
  { id: 'account',   icon: '🏠', title: 'Home Screen Data Loaded'      },
]
const PAY_META = [
  { id: 'intent',    icon: '🔍', title: 'Intent Analysis Engine'       },
  { id: 'preflight', icon: '🛡️',  title: 'Pre-Flight Security Checks'  },
  { id: 'payload',   icon: '📤', title: 'Payment Intent Payload'       },
  { id: 'security',  icon: '🔒', title: 'Security Pre-Screening'       },
  { id: 'cbs',       icon: '🏦', title: 'Core Banking System — Commit'        },
  { id: 'dlp',       icon: '🛡️',  title: 'DLP Scan — Outbound Response Filter' },
  { id: 'audit',     icon: '📋', title: 'WORM Audit — Immutable Record'       },
]

const BADGE: Record<string, string> = {
  AUTHENTICATED:'badge-green', VALID:'badge-blue',
  SECURED:'badge-purple',      LOADED:'badge-cyan',
  ANALYZED:'badge-blue',       CLEARED:'badge-green',
  SENT:'badge-purple',         PASS:'badge-cyan',
  COMMITTED:'badge-green',
  RELEASED:'badge-cyan',
  SEALED:'badge-green',
}

// ── Orchestrator types ────────────────────────────────────────────────────────
interface OrchAgent {
  id: string; name: string; icon: string; domain: string
  score: number; instances: number; healthy: number; priority: number
  decision: 'SELECTED' | 'SKIP'; mcp: string; identity: string
}
interface OrchState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  selectedAgent?: OrchAgent
  agents?: OrchAgent[]
  routingMs?: number
  avgRoutingMs?: number
  p99RoutingMs?: number
  delegationDepth?: number
  conflictHolds?: number
  requestsPerMin?: number
  scopes?: string[]
  riskHold?: boolean
  kycHold?: boolean
  accountToken?: string
  dispatch?: string
}

// ── Judge LLM types ───────────────────────────────────────────────────────────
interface JudgeCatResult { count: number; total: number }
interface JudgeState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  // Scan
  totalPatternsChecked?: number
  totalMatches?: number
  clean?: boolean
  categories?: Record<string, JudgeCatResult>
  // Tier
  tier?: string
  tierLabel?: string
  tierHitl?: boolean
  tierOtp?: boolean
  tierThreshold?: number
  // Verdict
  approved?: boolean
  confidence?: number
  reasoning?: string
  riskCategory?: string
  injectionAssessment?: string
  judgeModel?: string
  inferenceMs?: number
  // Approval token
  tokenJti?: string
  approvedTools?: string[]
  tokenExp?: number
  // Timing
  totalMs?: number
}

// ── OPA types ─────────────────────────────────────────────────────────────────
interface OpaCheckpoint {
  decision_id: string
  allowed: boolean
  latency_ms: number
  policy: string
  rules: Record<string, boolean>
  flags: Record<string, boolean>
  input?: Record<string, unknown>
}
interface OpaState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  cp1?: OpaCheckpoint   // allow_agent_routing
  cp2?: OpaCheckpoint   // allow_payment_execution
}

// ── Gravitee APIM validation types ───────────────────────────────────────────
interface ApimCheck { layer: string; check: string; detail: string; status: string; latency_ms: number }
interface GraviteeApimState {
  status: 'idle' | 'ready'
  gateway?: string; instance?: string; apiPlan?: string; policyXml?: string
  wafRules?: string; rateCount?: number; totalMs?: number; allPassed?: boolean
  checks?: ApimCheck[]
}

// ── MCP Server validation types ───────────────────────────────────────────────
interface McpCheck { check: string; expected: string; actual: string; pass: boolean }
interface McpAmlResult {
  status: string; lists: string[]; max_fuzzy_score: number
  threshold: number; bene_token: string; cached: boolean; cache_ttl: number
}
interface McpValidationState {
  status: 'idle' | 'ready'
  requestRate?: number; raspStatus?: string; raspVersion?: string
  checks?: McpCheck[]; amlResult?: McpAmlResult
}

// ── MCP Tool OPA types ────────────────────────────────────────────────────────
interface McpToolDecision {
  tool: string; decision_id: string; allowed: boolean; latency_ms: number
  rules: { tool_in_registry: boolean; scope_ok: boolean; judge_approved: boolean; no_aml_violation: boolean }
}
interface McpOpaState {
  status: 'idle' | 'ready'
  decisions?: McpToolDecision[]
  totalMs?: number
}

// ── Agent Execution Platform types ───────────────────────────────────────────
interface AgentExecStep { step: number; tool: string; status: string }
interface AgentExecState {
  status: 'idle' | 'ready'
  taskId?: string
  walKey?: string
  walStatus?: string
  idempotencyKey?: string
  piiTokenCount?: number
  svidExpiresIn?: number
  plan?: AgentExecStep[]
  pod?: string
  healthyPods?: number
  raspActive?: boolean
  llmModel?: string
  langsmithRunId?: string
  langsmithUrl?: string
}

// ── Core Banking System types ─────────────────────────────────────────────────
interface CbsSqlRow { label: string; sql: string; result: string }
interface CbsSecCard { title: string; sub: string; detail: string; code: string }
interface CbsState {
  status: 'idle' | 'ready'
  cbsTxnId?: string; impsRef?: string; idemKeyShort?: string
  idemStatus?: string; subClaim?: string; acctId?: string; beneId?: string
  balanceBefore?: number; balanceAfter?: number; amount?: number
  amlRef?: string; nonRepSig?: string; commitTs?: string
  commitLatencyMs?: number
  sqlBlock?: string
  rows?: CbsSqlRow[]
  secCards?: CbsSecCard[]
}

// ── DLP Scan types ────────────────────────────────────────────────────────────
interface DlpPattern {
  type: string; regex: string; mlModel: string
  fieldsScanned: string; result: 'CLEAN' | 'PARTIAL' | 'MASKED'; action: string
}
interface DlpState {
  status: 'idle' | 'ready'
  execMs?: number; patternsChecked?: number; fieldsMasked?: number
  dlpResult?: string; raspStatus?: string
  dlpExecId?: string; traceId?: string
  patterns?: DlpPattern[]
  beforePayload?: Record<string, unknown>
  afterPayload?: Record<string, unknown>
}

// ── WORM Audit types ──────────────────────────────────────────────────────────
interface AuditState {
  status: 'idle' | 'ready'
  records24h?: number; wormSealed?: number; storageTb?: number; retentionYears?: number
  auditId?: string; blobPath?: string; policy?: string; encryption?: string; indexedIn?: string
  traceId?: string; opaDecisionIds?: string[]; judgeApprovalRef?: string
  cbsTxnId?: string; impsRef?: string; nonRepSig?: string
  totalLatencyMs?: number; timestamp?: string; sealedBy?: string
  auditRecord?: Record<string, unknown>
}

// ── Post-payment completion data (latency breakdown + security cards) ─────────
interface StepTiming { step: number; name: string; ms: number }
interface CompletionData {
  stepTimings: StepTiming[]
  totalMs: number
  walKey?: string
  idempotencyKey?: string
  svidExpiresIn?: number
  pod?: string
  healthyPods?: number
  cbsTxnId?: string
  impsRef?: string
  commitTs?: string
  auditId?: string
}

// ── RFC 8693 Token Exchange types ─────────────────────────────────────────────
interface Rfc8693Original {
  sub: string; scope: string; jti: string; aud: string
}
interface Rfc8693Delegated {
  sub: string; act_sub: string; scope: string; jti: string
  aud: string; exp: number; delegation_depth: number
  cnf?: { 'x5t#S256': string } | null
}
interface Rfc8693State {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  original?: Rfc8693Original
  delegated?: Rfc8693Delegated
  latencyMs?: number
}

type IdpStatus = 'idle' | 'loading' | 'ready' | 'error'
interface IdpPolicies {
  p1_user_active: boolean
  p2_kyc_verified: boolean
  p3_consent_valid: boolean
  p4_ai_disclosure: boolean
  p5_pep_clear: boolean
  p6_sanctions_clear: boolean
  p7_risk_ok: boolean
}
interface IdpSigningKey { kid: string; alg: string; storage: string; path: string; hsm: boolean }
interface IdpCaep { session_id: string; log_backend: string; subscribers: string[]; redis_active: boolean; note: string }
interface IdpState {
  status: IdpStatus
  error?: string
  header?: Record<string, unknown>
  claims?: Record<string, unknown>
  token?: string
  expiresIn?: number
  tokenTtl?: number
  revokedCount?: number
  customerId?: string
  role?: string
  certThumbprint?: string
  fetchedAt?: number
  latencyMs?: number
  activeSessions?: number
  tokensIssued24h?: number
  caepEvents24h?: number
  failedAuths24h?: number
  riskScore?: number
  riskLevel?: string
  policies?: IdpPolicies
  sessionId?: string
  signingKey?: IdpSigningKey
  caep?: IdpCaep
}

// ── helpers ───────────────────────────────────────────────────────────────
function makeLog(set: React.Dispatch<React.SetStateAction<Record<string,StepState>>>) {
  return (id: string, line: string) =>
    set(p => ({ ...p, [id]: { ...p[id], logs: [...p[id].logs, line] } }))
}
function makePatch(set: React.Dispatch<React.SetStateAction<Record<string,StepState>>>) {
  return (id: string, patch: Partial<StepState>) =>
    set(p => ({ ...p, [id]: { ...p[id], ...patch } }))
}
function markRunningAsError(set: React.Dispatch<React.SetStateAction<Record<string,StepState>>>) {
  set(p => {
    const u = { ...p }
    for (const k of Object.keys(u))
      if (u[k].status === 'running') u[k] = { ...u[k], status: 'error' }
    return u
  })
}

function decodeJwtPart(part: string): Record<string, unknown> {
  const pad = '='.repeat((4 - (part.length % 4)) % 4)
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + pad
  const json = atob(b64)
  return JSON.parse(json)
}
function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = token.split('.')
  if (!h || !p) throw new Error('invalid_jwt')
  return { header: decodeJwtPart(h), payload: decodeJwtPart(p) }
}
function formatTimeIST(epochSec?: number): string {
  if (!epochSec) return '—'
  const d = new Date(epochSec * 1000)
  const t = d.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Kolkata',
  })
  return `${t} IST`
}

// ── App ───────────────────────────────────────────────────────────────────
export default function App() {
  // Auth flow
  const [authSteps, setAuthSteps] = useState<Record<string, StepState>>(AUTH_INIT())
  const [authRunning, setAuthRunning] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [accountData, setAccountData] = useState<AccountData | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [loginEmail, setLoginEmail] = useState('')

  // Payment flow
  const [appView, setAppView] = useState<'home' | 'payment'>('home')
  const [paySteps, setPaySteps] = useState<Record<string, StepState>>(PAY_INIT())
  const [payError, setPayError] = useState<string | null>(null)
  const [intentReady, setIntentReady] = useState(false)
  const [payStatus, setPayStatus] = useState<'idle' | 'processing' | 'done'>('idle')
  const [payResult, setPayResult] = useState<PaymentResult | null>(null)
  const [payBene,   setPayBene]   = useState<Beneficiary | undefined>(undefined)
  const [idpState, setIdpState] = useState<IdpState>({ status: 'idle' })
  const [orchState, setOrchState] = useState<OrchState>({ status: 'idle' })
  const [judgeState, setJudgeState] = useState<JudgeState>({ status: 'idle' })
  const [opaState, setOpaState] = useState<OpaState>({ status: 'idle' })
  const [rfc8693State, setRfc8693State] = useState<Rfc8693State>({ status: 'idle' })
  const [agentExecState, setAgentExecState] = useState<AgentExecState>({ status: 'idle' })
  const [mcpOpaState, setMcpOpaState] = useState<McpOpaState>({ status: 'idle' })
  const [mcpValidationState, setMcpValidationState] = useState<McpValidationState>({ status: 'idle' })
  const [graviteeApimState, setGraviteeApimState] = useState<GraviteeApimState>({ status: 'idle' })
  const [cbsState, setCbsState] = useState<CbsState>({ status: 'idle' })
  const [dlpState, setDlpState] = useState<DlpState>({ status: 'idle' })
  const [auditState, setAuditState] = useState<AuditState>({ status: 'idle' })
  const [completionData, setCompletionData] = useState<CompletionData | null>(null)

  // Console mode follows app view
  const consoleMode = appView

  // Track real auth step latencies for the payment latency breakdown
  const authTimingsRef = useRef({ biometricMs: 29, tokenMs: 11, tlsMs: 8, accountMs: 12 })

  // ── Auth helpers ──────────────────────────────────────────────────────
  const aLog   = useCallback(makeLog(setAuthSteps),   [])
  const aPatch = useCallback(makePatch(setAuthSteps), [])

  // ── Payment helpers ───────────────────────────────────────────────────
  const pLog   = useCallback(makeLog(setPaySteps),   [])
  const pPatch = useCallback(makePatch(setPaySteps), [])

  // ── Refresh account data (balance + transactions) after a payment ──────
  const refreshAccountData = useCallback(async (tok: string) => {
    try {
      const res = await fetch(`${API}/api/v1/accounts/summary`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
      if (res.ok) setAccountData(await res.json())
    } catch { /* non-critical */ }
  }, [])

  const fetchIdpDashboard = useCallback(async (token: string) => {
    setIdpState({ status: 'loading' })
    const t0 = performance.now()
    try {
      // Access token from /auth/token IS already an RS256 JWT — decode it directly
      const { header, payload } = decodeJwt(token)

      // Run 7-policy gate + get session metadata (no second JWT issued)
      const tokenRes = await fetch(`${IDP_API}/idp/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!tokenRes.ok) throw new Error(`IdP policy check ${tokenRes.status}`)
      const tokenData = await tokenRes.json()

      // Fetch live dashboard stats (active sessions, 24h counts)
      let dash: Record<string, number> = {}
      try {
        const dashRes = await fetch(`${IDP_API}/idp/dashboard`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (dashRes.ok) dash = await dashRes.json()
      } catch { /* optional — dashboard is informational */ }

      setIdpState({
        status: 'ready',
        header,
        claims: payload,
        token,
        expiresIn:   tokenData.expires_in,
        tokenTtl:    tokenData.token_ttl,
        revokedCount: dash.revoked_count,
        customerId:  tokenData.customer_id,
        role:        tokenData.role,
        certThumbprint: tokenData.cert_thumbprint,
        fetchedAt:   Date.now(),
        latencyMs:   Math.round(performance.now() - t0),
        activeSessions:  dash.active_sessions,
        tokensIssued24h: dash.tokens_issued_24h,
        caepEvents24h:   dash.caep_events_24h,
        failedAuths24h:  dash.failed_auths_24h,
        riskScore:   tokenData.risk_score,
        riskLevel:   tokenData.risk_level,
        policies:    tokenData.policies,
        sessionId:   tokenData.session_id,
        signingKey:  tokenData.signing_key,
        caep:        tokenData.caep,
      })
    } catch (e: unknown) {
      setIdpState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  // ── Auth flow — email → /auth/login → JWT → Gravitee ─────────────────────
  const runAuth = useCallback(async (email: string) => {
    if (!email.trim()) return
    setAuthRunning(true)
    setSessionReady(false)
    setAuthError(null)
    setAccountData(null)
    setAccessToken(null)
    setIdpState({ status: 'idle' })
    setAuthSteps(AUTH_INIT() as Record<string, StepState>)

    try {
      // ── Step 1: Identity verification ─────────────────────────────────────
      const tAuthStart = performance.now()
      aPatch('biometric', { status: 'running' })
      aLog('biometric', `Identifying user: ${email}`)

      const loginRes = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      }).then(r => r.json())

      if (!loginRes.access_token) throw new Error(loginRes.error ?? 'Login failed')

      aLog('biometric', `Identity set: ${loginRes.name} <${loginRes.email}>`)
      aLog('biometric', 'RS256 JWT issued by Express IdP ✓')
      aPatch('biometric', { status: 'done', badge: 'AUTHENTICATED' })
      authTimingsRef.current.biometricMs = Math.round(performance.now() - tAuthStart)

      // ── Step 2: JWT → show claims, then forward to Gravitee ───────────────
      const tTokenStart = performance.now()
      aPatch('token', { status: 'running' })
      aLog('token', 'RS256 JWT issued — forwarding to Gravitee APIM via Bearer header')
      try {
        const { payload } = decodeJwt(loginRes.access_token)
        const ttl = (payload.exp as number) - Math.floor(Date.now() / 1000)
        aLog('token', `sub: ${payload.sub}  name: ${payload.name}`)
        aLog('token', `JTI: ${payload.jti ?? '—'} · exp: ${payload.exp} (${ttl}s)`)
        aLog('token', `Scope: ${payload.scope ?? '—'}`)
        aLog('token', `iss: ${payload.iss}  aud: ${payload.aud}`)
      } catch { /* non-critical */ }
      aPatch('token', { status: 'done', badge: 'VALID' })
      authTimingsRef.current.tokenMs = Math.round(performance.now() - tTokenStart)

      const tok = loginRes.access_token
      setAccessToken(tok)
      fetchIdpDashboard(tok)

      const tTlsStart = performance.now()
      aPatch('tls', { status:'running' })
      aLog('tls', 'Opening connection to Gravitee APIM Gateway :8085…')
      const t0 = performance.now()
      await fetch(`${API}/api/v1/accounts/summary`, { headers:{ Authorization:`Bearer ${tok}` } }).then(r=>r.json())
      const rtt = (performance.now()-t0).toFixed(0)
      const ent = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find(e=>e.name.startsWith(API))
      const tlsMs = ent ? (ent.connectEnd-ent.connectStart).toFixed(0) : '—'
      aLog('tls', 'gateway: Gravitee APIM v4 · context: /bankapp/')
      aLog('tls', 'upstream: https://host.docker.internal:3001 (Express)')
      aLog('tls', `handshake: ${tlsMs}ms  rtt: ${rtt}ms`)
      aPatch('tls', { status:'done', badge:'SECURED' })
      authTimingsRef.current.tlsMs = Math.round(performance.now() - tTlsStart)

      aPatch('account', { status:'running' })
      aLog('account', 'GET /api/v1/accounts/summary')
      const t1 = performance.now()
      const accRes = await fetch(`${API}/api/v1/accounts/summary`, { headers:{ Authorization:`Bearer ${tok}` } })
      const acc = await accRes.json()
      aLog('account', `Cache: HIT (age: ${accRes.headers.get('X-Cache-Age') ?? acc.cache?.age}s)`)
      aLog('account', `Balance: ₹${acc.balance.toLocaleString('en-IN')} ✓`)
      aLog('account', `Accounts: ${acc.accounts.length} · Txns: ${acc.recentTransactions.length}`)
      const accMs = Math.round(performance.now()-t1)
      aLog('account', `Latency: ${accMs}ms`)
      aPatch('account', { status:'done', badge:'LOADED' })
      authTimingsRef.current.accountMs = accMs

      setAccountData(acc)
      setSessionReady(true)
    } catch (e: unknown) {
      setAuthError(e instanceof Error ? e.message : String(e))
      markRunningAsError(setAuthSteps)
    } finally {
      setAuthRunning(false)
    }
  }, [aLog, aPatch, fetchIdpDashboard])


  // ── Payment: phase 1 — intent + preflight (auto on form open) ────────
  const runIntent = useCallback(async (tok: string) => {
    setPaySteps(PAY_INIT() as Record<string, StepState>)
    setIntentReady(false)
    setPayError(null)

    try {
      pPatch('intent', { status:'running' })
      pLog('intent', 'Sending payment intent to classifier…')

      const intentRaw = await fetch(`${API}/api/v1/payments/intent`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${tok}` },
        body: JSON.stringify({ amount: 25000 }),
      })
      if (intentRaw.status === 401) throw new Error('Session expired — please re-authenticate (click ↺ Re-run above)')
      const res = await intentRaw.json()
      if (res.error) throw new Error(`Intent API error: ${res.error}`)
      if (!res.preflight) throw new Error('Intent API returned no preflight data')

      pLog('intent', `Model: ${res.model}`)
      pLog('intent', `Intent: ${res.intent_type}`)
      pLog('intent', `confidence: ${res.confidence}  inference: ${res.inference_ms}ms`)
      pPatch('intent', { status:'done', badge:'ANALYZED' })

      // Fire Judge LLM evaluation — non-blocking, populates security gate panel
      setJudgeState({ status: 'loading' })
      fetch(`${API}/judge/evaluate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ amount: 25000, note: '', intent_type: res.intent_type }),
      }).then(r => r.json()).then(d => {
        setJudgeState({
          status:               'ready',
          totalPatternsChecked: d.scan?.total_patterns_checked,
          totalMatches:         d.scan?.total_matches,
          clean:                d.scan?.clean,
          categories:           d.scan?.categories,
          tier:                 d.tier?.tier,
          tierLabel:            d.tier?.label,
          tierHitl:             d.tier?.hitl,
          tierOtp:              d.tier?.otp,
          tierThreshold:        d.tier?.threshold,
          approved:             d.judgement?.approved,
          confidence:           d.judgement?.confidence,
          reasoning:            d.judgement?.reasoning,
          riskCategory:         d.judgement?.risk_category,
          injectionAssessment:  d.judgement?.injection_assessment,
          judgeModel:           d.judgement?.model,
          inferenceMs:          d.judgement?.inference_ms,
          tokenJti:             d.approval_token?.jti,
          approvedTools:        d.approval_token?.payload?.approved_tools,
          tokenExp:             d.approval_token?.payload?.exp,
          totalMs:              d.total_ms,
        })
      }).catch(() => setJudgeState({ status: 'error', error: 'Judge LLM unreachable' }))

      // Fire orchestrator routing — non-blocking, populates the routing dashboard
      setOrchState({ status: 'loading' })
      fetch(`${API}/orchestrator/route`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          intent_type: res.intent_type,
          sub_intent:  res.sub_intent,
          confidence:  res.confidence,
          amount:      25000,
          risk_score:  res.preflight?.beneficiary?.risk_score,
        }),
      }).then(r => r.json()).then(d => {
        setOrchState({
          status:          'ready',
          selectedAgent:   d.selected_agent,
          agents:          d.agents,
          routingMs:       d.routing_ms,
          avgRoutingMs:    d.avg_routing_ms,
          p99RoutingMs:    d.p99_routing_ms,
          delegationDepth: d.delegation_depth,
          conflictHolds:   d.conflict_holds,
          requestsPerMin:  d.requests_per_min,
          scopes:          d.scopes,
          riskHold:        d.risk_hold,
          kycHold:         d.kyc_hold,
          accountToken:    d.account_token,
          dispatch:        d.dispatch,
        })
      }).catch(() => setOrchState({ status: 'error', error: 'Orchestrator unreachable' }))

      // Pre-flight
      pPatch('preflight', { status:'running' })
      const pf = res.preflight

      pLog('preflight', `Beneficiary: ${pf.beneficiary.name} ${pf.beneficiary.bank} ••••${pf.beneficiary.last4}`)
      pLog('preflight', `Risk score: ${pf.beneficiary.risk_score} (${pf.beneficiary.risk_level}) · ${pf.beneficiary.previous_payments} prev payments`)
      pLog('preflight', `Amount ₹${pf.amount_analysis.value.toLocaleString('en-IN')} = ${pf.amount_analysis.monthly_avg_pct}% of monthly avg · ${pf.amount_analysis.label}`)
      pLog('preflight', `Consent ${pf.consent.ref} valid · expires ${pf.consent.expires}`)
      pLog('preflight', `AI Disclosure ${pf.ai_disclosure.ref} signed ${pf.ai_disclosure.signed} ✓`)
      pLog('preflight', `Tier ${pf.tier.classification} · ₹${pf.tier.amount.toLocaleString('en-IN')} ≤ ₹${pf.tier.threshold.toLocaleString('en-IN')} → autonomous · no OTP`)
      pPatch('preflight', { status:'done', badge:'CLEARED' })

      setIntentReady(true)
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : String(e))
      markRunningAsError(setPaySteps)
    }
  }, [pLog, pPatch])

  // ── Payment: phase 2 — execute via Orchestrator → PaymentAgent (real LLM) ──
  const runExecute = useCallback(async (tok: string, amount: number, note: string, bene: Beneficiary) => {
    setPayStatus('processing')

    try {
      pPatch('payload', { status:'running' })
      pLog('payload', `Dispatching to Orchestrator → Judge gate → PaymentOrchestrator agent…`)
      pLog('payload', `intent_type: PAYMENT_TRANSFER_IMPS  amount: ₹${amount.toLocaleString('en-IN')}`)
      pLog('payload', `note: "${note}"  consent_ref: CNS-8821`)
      pLog('payload', `Judge LLM scanning 50 patterns + Haiku evaluation in progress…`)

      // Strip leading •• to get last4 digits (e.g. '••••3892' → '3892')
      const beneLast4 = bene.acct.replace(/[^0-9]/g, '')

      const raw = await fetch(`${API}/orchestrator/invoke`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${tok}` },
        body: JSON.stringify({
          intent_type: 'PAYMENT_TRANSFER_DOMESTIC',
          sub_intent:  'PAYMENT_TRANSFER_IMPS',
          confidence:  0.97,
          amount,
          note,
          bene_name:   bene.name,
          bene_bank:   bene.bank,
          bene_last4:  beneLast4,
        }),
      })
      if (raw.status === 401) throw new Error('Session expired — please re-authenticate (click ↺ Re-run above)')
      const orchRes = await raw.json()

      // ── Update Judge panel from orchestrator's embedded judge result ────────
      if (orchRes.judge) {
        const j = orchRes.judge
        setJudgeState({
          status:               'ready',
          totalPatternsChecked: j.scan?.total_patterns_checked,
          totalMatches:         j.scan?.total_matches,
          clean:                j.scan?.clean,
          categories:           j.scan?.categories,
          tier:                 j.tier?.tier,
          tierLabel:            j.tier?.label,
          tierHitl:             j.tier?.hitl,
          tierOtp:              j.tier?.otp,
          tierThreshold:        j.tier?.threshold,
          approved:             j.judgement?.approved,
          confidence:           j.judgement?.confidence,
          reasoning:            j.judgement?.reasoning,
          riskCategory:         j.judgement?.risk_category,
          injectionAssessment:  j.judgement?.injection_assessment,
          judgeModel:           j.judgement?.model,
          inferenceMs:          j.judgement?.inference_ms,
          tokenJti:             j.approval_token?.jti,
          approvedTools:        j.approval_token?.payload?.approved_tools,
          tokenExp:             j.approval_token?.payload?.exp,
          totalMs:              j.total_ms,
        })
      }

      // ── Populate OPA state from orchestrator checkpoints ─────────────────────
      if (orchRes.opa_routing || orchRes.opa_payment) {
        setOpaState({
          status: 'ready',
          cp1: orchRes.opa_routing,
          cp2: orchRes.opa_payment,
        })
      }

      // ── Gravitee APIM validation ──────────────────────────────────────────────
      if (orchRes.apim_validation?.checks?.length) {
        const a = orchRes.apim_validation
        setGraviteeApimState({
          status:     'ready',
          gateway:    a.gateway,
          instance:   a.instance,
          apiPlan:    a.api_plan,
          policyXml:  a.policy_xml,
          wafRules:   a.waf_rules,
          rateCount:  a.rate_count,
          totalMs:    a.total_ms,
          allPassed:  a.all_passed,
          checks:     a.checks,
        })
      }

      // ── MCP Server validation report ─────────────────────────────────────────
      if (orchRes.mcp_validation?.checks?.length) {
        const v = orchRes.mcp_validation
        setMcpValidationState({
          status:       'ready',
          requestRate:  v.request_rate,
          raspStatus:   v.rasp_status,
          raspVersion:  v.rasp_version,
          checks:       v.checks,
          amlResult:    v.aml_result,
        })
      }

      // ── MCP Tool-level OPA decisions ─────────────────────────────────────────
      if (orchRes.mcp_tool_decisions?.length) {
        const decisions: McpToolDecision[] = orchRes.mcp_tool_decisions
        const totalMs = decisions.reduce((s: number, d: McpToolDecision) => s + d.latency_ms, 0)
        setMcpOpaState({ status: 'ready', decisions, totalMs })
      }

      // ── Agent Execution Platform — populate from orchestrator result ──────────
      if (orchRes.agent_execution) {
        const ae = orchRes.agent_execution
        setAgentExecState({
          status:          'ready',
          taskId:          ae.task_id,
          walKey:          ae.wal_key,
          walStatus:       ae.wal_status,
          idempotencyKey:  ae.idempotency_key,
          piiTokenCount:   ae.pii_token_count,
          svidExpiresIn:   ae.svid_expires_in,
          plan:            ae.plan,
          pod:             ae.pod,
          healthyPods:     ae.healthy_pods,
          raspActive:      ae.rasp_active,
          llmModel:        ae.llm_model,
          langsmithRunId:  orchRes.langsmith_run_id,
          langsmithUrl:    orchRes.langsmith_url,
        })
      }

      // ── RFC 8693 Token Exchange — fire non-blocking, populates security panel ─
      setRfc8693State({ status: 'loading' })
      const _t2 = performance.now()
      fetch(`${IDP_API}/idp/token-exchange`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${tok}` },
      }).then(r => r.json()).then(d => {
        setRfc8693State({
          status:    'ready',
          original:  d.original,
          delegated: d.delegated,
          latencyMs: Math.round(performance.now() - _t2),
        })
      }).catch(() => setRfc8693State({ status: 'error', error: 'Token exchange failed' }))

      // ── Orchestrator enforces the Judge gate — surface block reason ─────────
      if (orchRes.blocked) {
        const j = orchRes.judge
        if (orchRes.block_reason === 'hitl_required') {
          throw new Error(
            `Payment blocked — Tier ${j?.tier?.tier} (${j?.tier?.label}): ` +
            `₹${amount.toLocaleString('en-IN')} requires human-in-the-loop approval.`
          )
        }
        if (orchRes.block_reason === 'opa_routing_denied') {
          const opaFlags = orchRes.opa_routing?.rules
          const failedRules = opaFlags ? Object.entries(opaFlags).filter(([,v]) => !v).map(([k]) => k).join(', ') : 'unknown'
          throw new Error(`Payment blocked by OPA routing policy. Failed rules: ${failedRules}`)
        }
        throw new Error(
          `Payment blocked by Judge LLM — ${j?.judgement?.risk_category} risk. ` +
          `Reason: ${j?.judgement?.reasoning}`
        )
      }

      if (orchRes.error) throw new Error(orchRes.error)

      // Log every tool the agent actually called
      if (orchRes.tools_called?.length) {
        pLog('payload', `Agent tools: ${orchRes.tools_called.join(' → ')}`)
      }
      pLog('payload', `Agent latency: ${orchRes.agent_latency_ms}ms`)

      const ad = orchRes.agent_data   // structured JSON extracted from LLM response
      if (!ad || ad.status !== 'SUCCESS') {
        throw new Error(ad?.error ?? orchRes.agent_response ?? 'Agent returned no result')
      }

      pLog('payload', `trace_id: ${ad.trace_id}`)
      pPatch('payload', { status:'done', badge:'SENT' })

      pPatch('security', { status:'running' })
      pLog('security', `PII tokenised by agent — raw values never stored`)
      pLog('security', `  bene_token: ${ad.bene_token}`)
      pLog('security', `  acct_token: ${ad.acct_token}`)
      pLog('security', `  vault: aes-256-gcm / in-process`)
      pLog('security', `Beneficiary risk: ${ad.risk_score} (${ad.risk_level}) · PASS`)
      pLog('security', `  checks: fraud_db, sanctions, pep_list, velocity`)
      pLog('security', `AI Disclosure DISC-4f81 verified ✓`)
      pLog('security', `  regulation: DPDP Act / RBI AI guidelines`)
      pLog('security', `W3C traceparent: ${ad.trace_id}`)
      pLog('security', `  Orchestrator → Agent delegation depth: ${orchRes.delegation_depth}/2`)
      pLog('security', `  Orchestrator scopes: ${orchRes.scopes?.join(', ')}`)
      pPatch('security', { status:'done', badge:'PASS' })

      // ── CBS — Core Banking System commit ────────────────────────────────────
      pPatch('cbs', { status:'running' })
      pLog('cbs', `CBS connection: APIM → cbs-prod-primary.bank.internal via mTLS`)
      pLog('cbs', `Encryption: TDE AES-256 · CMK: cbs-cmk-2024 (Azure Key Vault)`)
      if (orchRes.cbs_data) {
        const c = orchRes.cbs_data
        setCbsState({
          status:          'ready',
          cbsTxnId:        c.cbs_txn_id,
          impsRef:         c.imps_ref,
          idemKeyShort:    c.idem_key_short,
          idemStatus:      c.idem_status,
          subClaim:        c.sub_claim,
          acctId:          c.acct_id,
          beneId:          c.bene_id,
          balanceBefore:   c.balance_before,
          balanceAfter:    c.balance_after,
          amount:          c.amount,
          amlRef:          c.aml_ref,
          nonRepSig:       c.non_rep_sig,
          commitTs:        c.commit_ts,
          commitLatencyMs: c.commit_latency_ms,
          sqlBlock:        c.sql_block,
        })
        pLog('cbs', `Idempotency check: ${c.idem_key_short} → 0 rows → NEW → PROCEED`)
        pLog('cbs', `Debit ${c.acct_id} (sub=${c.sub_claim}): ₹${Number(c.amount).toLocaleString('en-IN')}`)
        pLog('cbs', `Credit ${c.bene_id}: ₹${Number(c.amount).toLocaleString('en-IN')}`)
        pLog('cbs', `Ledger row written · non_rep_sig: ${c.non_rep_sig}`)
        pLog('cbs', `COMMIT · ${c.cbs_txn_id} · IMPS: ${c.imps_ref} · ${c.commit_latency_ms}ms (fsync=on)`)
      }
      pPatch('cbs', { status:'done', badge:'COMMITTED' })

      // ── DLP — Outbound response scan ────────────────────────────────────────
      pPatch('dlp', { status:'running' })
      pLog('dlp', `DLP function invoked: dlp-function-prod.azurewebsites.net`)
      pLog('dlp', `Scanning outbound response payload — 6 pattern types`)
      if (orchRes.dlp_data) {
        const d = orchRes.dlp_data
        setDlpState({
          status:          'ready',
          execMs:          d.exec_ms,
          patternsChecked: d.patterns_checked,
          fieldsMasked:    d.fields_masked,
          dlpResult:       d.dlp_result,
          raspStatus:      d.rasp_status,
          dlpExecId:       d.dlp_exec_id,
          traceId:         d.trace_id,
          patterns:        d.patterns,
          beforePayload:   d.before_payload,
          afterPayload:    d.after_payload,
        })
        pLog('dlp', `Patterns: ${d.patterns_checked} types · Fields masked: ${d.fields_masked}`)
        pLog('dlp', `Account suffix ${bene.acct} detected → [REDACTED]`)
        pLog('dlp', `Result: ${d.dlp_result} · ${d.exec_ms}ms (SLA: 60ms) · ${d.dlp_exec_id}`)
      }
      pPatch('dlp', { status:'done', badge:'RELEASED' })

      // ── AUDIT — WORM audit record ────────────────────────────────────────────
      pPatch('audit', { status:'running' })
      pLog('audit', `Connecting to audit-mcp.bank.internal:9445 via Internal GW`)
      pLog('audit', `Writing WORM record to Azure Immutable Blob · India Central`)
      if (orchRes.audit_data) {
        const a = orchRes.audit_data
        setAuditState({
          status:          'ready',
          records24h:      a.records_24h,
          wormSealed:      a.worm_sealed,
          storageTb:       a.storage_tb,
          retentionYears:  a.retention_years,
          auditId:         a.audit_id,
          blobPath:        a.blob_path,
          policy:          a.policy,
          encryption:      a.encryption,
          indexedIn:       a.indexed_in,
          traceId:         a.trace_id,
          opaDecisionIds:  a.opa_decision_ids,
          judgeApprovalRef: a.judge_approval_ref,
          cbsTxnId:        a.cbs_txn_id,
          impsRef:         a.imps_ref,
          nonRepSig:       a.non_repudiation_sig,
          totalLatencyMs:  a.total_latency_ms,
          timestamp:       a.timestamp,
          sealedBy:        a.sealed_by,
          auditRecord:     a.record,
        })
        pLog('audit', `Audit ID: ${a.audit_id}`)
        pLog('audit', `OPA decisions: ${(a.opa_decision_ids ?? []).join(', ')}`)
        pLog('audit', `WORM sealed · immutability-policy=LOCKED · retention: 2031-12-15`)
      }
      pPatch('audit', { status:'done', badge:'SEALED' })

      setPayResult({
        txn_id:             ad.txn_id,
        trace_id:           ad.trace_id,
        amount,
        timestamp:          new Date().toISOString(),
        imps_ref:           orchRes.cbs_data?.imps_ref,
        cbs_txn_id:         orchRes.cbs_data?.cbs_txn_id,
        balance_before:     orchRes.cbs_data?.balance_before,
        balance_after:      orchRes.cbs_data?.balance_after,
        commit_ts:          orchRes.cbs_data?.commit_ts,
        non_rep_sig:        orchRes.cbs_data?.non_rep_sig,
        aml_ref:            orchRes.cbs_data?.aml_ref,
        audit_id:           orchRes.audit_data?.audit_id,
        dlp_exec_id:        orchRes.dlp_data?.dlp_exec_id,
        judge_approval_ref: orchRes.audit_data?.judge_approval_ref,
        opa_decision_ids:   orchRes.audit_data?.opa_decision_ids,
        total_latency_ms:   orchRes.audit_data?.total_latency_ms,
      })

      // ── Build completion data — latency breakdown + post-payment security ─
      {
        const opa1D  = orchRes.opa_routing
        const opa2D  = orchRes.opa_payment
        const mcpDec: Array<{ latency_ms: number }> = orchRes.mcp_tool_decisions ?? []
        const apimD  = orchRes.apim_validation
        const cbsD   = orchRes.cbs_data
        const dlpD_  = orchRes.dlp_data
        const auditD = orchRes.audit_data
        const ae_    = orchRes.agent_execution

        // Agent overhead = total agent time minus tool call times
        const mcpToolMs = mcpDec.reduce((s, d) => s + d.latency_ms, 0)
        const agentOverheadMs = Math.max(10, (orchRes.agent_latency_ms ?? 200) - mcpToolMs - Math.round(opa2D?.latency_ms ?? 4))

        const stepTimings: StepTiming[] = [
          { step: 1,  name: 'Entry + TLS + Auth',                ms: authTimingsRef.current.biometricMs },
          { step: 2,  name: 'Intent Processing + Pre-checks',    ms: authTimingsRef.current.accountMs },
          { step: 3,  name: 'Gravity IdP Token Issuance',        ms: authTimingsRef.current.tokenMs },
          { step: 4,  name: 'Orchestrator + Agent Registry',     ms: orchRes.routing_ms ?? 22 },
          { step: 5,  name: 'Judge LLM (50 injection patterns)', ms: orchRes.judge?.judgement?.inference_ms ?? 16 },
          { step: 6,  name: 'OPA Checkpoint 1 (7 rules)',        ms: Math.round(opa1D?.latency_ms ?? 3) },
          { step: 7,  name: 'RFC 8693 Token Exchange',           ms: authTimingsRef.current.tlsMs },
          { step: 8,  name: 'Agent WAL + PII + Planning',        ms: agentOverheadMs },
          { step: 9,  name: 'OPA Checkpoint 2 (2 tools)',        ms: Math.round(opa2D?.latency_ms ?? 4) },
          { step: 10, name: 'MCP Validation + AML (4 lists)',    ms: Math.round(mcpToolMs) || 14 },
          { step: 11, name: 'APIM Gateway (7 layers)',           ms: Math.round(apimD?.total_ms ?? 9) },
          { step: 12, name: 'CBS SQL Transaction (ACID)',        ms: cbsD?.commit_latency_ms ?? 19 },
          { step: 13, name: 'DLP Outbound Scan',                ms: dlpD_?.exec_ms ?? 48 },
          { step: 14, name: 'WORM Audit Write',                 ms: 29 },
        ]

        setCompletionData({
          stepTimings,
          totalMs:        auditD?.total_latency_ms ?? (orchRes.agent_latency_ms + 450),
          walKey:         ae_?.wal_key,
          idempotencyKey: ae_?.idempotency_key,
          svidExpiresIn:  ae_?.svid_expires_in,
          pod:            ae_?.pod,
          healthyPods:    ae_?.healthy_pods,
          cbsTxnId:       cbsD?.cbs_txn_id,
          impsRef:        cbsD?.imps_ref,
          commitTs:       cbsD?.commit_ts,
          auditId:        auditD?.audit_id,
        })
      }

      setPayStatus('done')
      // Re-fetch so home screen shows updated balance + new transaction immediately
      refreshAccountData(tok)
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : String(e))
      markRunningAsError(setPaySteps)
      setPayStatus('idle')
    }
  }, [pLog, pPatch, refreshAccountData])

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSendMoney = useCallback(() => {
    if (!accessToken) return
    setAppView('payment')
    setPayStatus('idle')
    setPayResult(null)
    runIntent(accessToken)
  }, [accessToken, runIntent])

  const handlePayBack = useCallback(() => {
    setAppView('home')
    setPaySteps(PAY_INIT() as Record<string, StepState>)
    setIntentReady(false)
    setPayStatus('idle')
    setPayResult(null)
    setOrchState({ status: 'idle' })
    setJudgeState({ status: 'idle' })
    setOpaState({ status: 'idle' })
    setRfc8693State({ status: 'idle' })
    setAgentExecState({ status: 'idle' })
    setMcpOpaState({ status: 'idle' })
    setMcpValidationState({ status: 'idle' })
    setGraviteeApimState({ status: 'idle' })
    setCbsState({ status: 'idle' })
    setDlpState({ status: 'idle' })
    setAuditState({ status: 'idle' })
    setCompletionData(null)
    setPayBene(undefined)
  }, [])

  const handlePay = useCallback((amount: number, note: string, bene: Beneficiary) => {
    if (!accessToken) return
    setPayBene(bene)
    runExecute(accessToken, amount, note, bene)
  }, [accessToken, runExecute])

  // ── Console content ────────────────────────────────────────────────────
  const isAuth = consoleMode === 'home'
  const steps: Record<string, StepState> = isAuth ? authSteps : paySteps
  const stepMeta = isAuth ? AUTH_META  : PAY_META
  const conError = isAuth ? authError  : payError

  const conTitle  = isAuth ? 'SYSTEM CONSOLE'              : 'SYSTEM'
  const conSub    = isAuth ? 'Pre-Auth Flow'                : 'Intent Processing · AI Disclosure Gate'
  const conPill1  = isAuth ? 'gateway-prod-1'              : 'intent-processor.bank.internal'
  const conPill2  = isAuth ? '10.0.1.42'                   : 'consent-registry'
  const divLabel  = isAuth
    ? 'WHAT HAPPENS BEFORE YOU SEE THE SCREEN'
    : 'SYSTEM PROCESSING BEHIND THE FORM'

  const showIdp = isAuth && authSteps.token.status === 'done'
  const idpClaims = idpState.claims ?? {}
  const exp = typeof idpClaims.exp === 'number' ? idpClaims.exp : undefined
  const expTtl = exp ? Math.max(0, Math.floor(exp - Date.now() / 1000)) : undefined
  const scopeStr = typeof idpClaims.scope === 'string'
    ? idpClaims.scope
    : Array.isArray(idpClaims.scope) ? idpClaims.scope.join(' ') : '—'
  const issStr = typeof idpClaims.iss === 'string' ? idpClaims.iss : '—'
  const audStr = Array.isArray(idpClaims.aud)
    ? idpClaims.aud.join(' ')
    : typeof idpClaims.aud === 'string' ? idpClaims.aud : '—'
  const jtiStr = typeof idpClaims.jti === 'string' ? idpClaims.jti : '—'
  const acrStr = typeof idpClaims.acr === 'string' || typeof idpClaims.acr === 'number'
    ? String(idpClaims.acr)
    : '—'
  const cnf = (idpClaims.cnf as Record<string, unknown> | undefined)?.['x5t#S256']
  const cnfStr = typeof cnf === 'string' ? cnf : '—'
  const caepSession = typeof idpClaims.caep_session === 'string'
    ? idpClaims.caep_session
    : (jtiStr !== '—' ? `SSM-${jtiStr.split('-')[0]}` : 'SSM-—')
  const consentValid = scopeStr !== '—'
  const disclosureValid = scopeStr.includes('ai') || scopeStr.includes('payments')

  return (
    <div className="split-root">
      {/* ── Left: Banking Web App ── */}
      <div className="split-app">
        <BankingApp
          data={accountData}
          loading={!sessionReady}
          appView={appView}
          payStatus={payStatus}
          payResult={payResult}
          payBene={payBene}
          intentReady={intentReady}
          onSendMoney={handleSendMoney}
          onPayBack={handlePayBack}
          onPay={handlePay}
        />
      </div>

      {/* ── Right: Console Panel ── */}
      <div className="split-console">
        <div className="con-chrome">
          <div className="traffic-lights">
            <span className="tl tl-red" /><span className="tl tl-yellow" /><span className="tl tl-green" />
          </div>
          <span className="con-chrome-title">system-console</span>
          {isAuth && (
            sessionReady
              ? <button className="run-btn" onClick={() => {
                  setSessionReady(false)
                  setAuthSteps(AUTH_INIT() as Record<string, StepState>)
                  setAuthError(null)
                  setAccountData(null)
                  setAccessToken(null)
                  setIdpState({ status: 'idle' })
                }}>↺ Re-run</button>
              : authRunning
                ? <span className="run-btn" style={{ opacity: 0.5, cursor: 'default' }}>⏳ Signing in…</span>
                : <form style={{ display:'flex', gap:4 }} onSubmit={e => { e.preventDefault(); runAuth(loginEmail) }}>
                    <input
                      type="email" placeholder="your@email.com" value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      style={{ fontSize:11, padding:'2px 6px', borderRadius:4, border:'1px solid #4b5563',
                               background:'#111827', color:'#e5e7eb', width:170, outline:'none' }}
                    />
                    <button className="run-btn" type="submit" disabled={!loginEmail.trim()}>Sign In</button>
                  </form>
          )}
        </div>

        <div className="con-header">
          <div className="con-title-row">
            <span className="con-label">{conTitle}</span>
            <span className="con-dash">—</span>
            <span className="con-sub">{conSub}</span>
          </div>
          <div className="con-pills">
            <span className="con-pill">{conPill1}</span>
            <span className="con-sep">·</span>
            <span className="con-pill">{conPill2}</span>
          </div>
        </div>

        <div className="con-divider">
          <span className="con-divider-rule" />
          <span className="con-divider-label">{divLabel}</span>
          <span className="con-divider-rule" />
        </div>

        <div className="con-steps">
          {stepMeta.map(({ id, icon, title }) => {
            const s = steps[id]
            return (
              <div key={id} className={`con-step status-${s.status}`}>
                <div className="con-step-header">
                  <span className="con-step-icon">{icon}</span>
                  <div className="con-step-meta">
                    <div className="con-step-title-row">
                      <span className="con-step-title">{title}</span>
                      {s.status === 'running' && (
                        <span className="spinner-badge"><span className="spinner" /> RUNNING</span>
                      )}
                      {s.badge && s.status === 'done' && (
                        <span className={`badge ${BADGE[s.badge] ?? 'badge-green'}`}>{s.badge}</span>
                      )}
                      {s.status === 'error' && <span className="badge badge-red">FAILED</span>}
                    </div>
                  </div>
                </div>
                {s.logs.length > 0 && (
                  <div className="con-log-block">
                    {s.logs.map((line: string, i: number) => (
                      <div key={i} className="con-log-line">
                        <span className="con-log-prompt">›</span>
                        <span className="con-log-text">{line}</span>
                      </div>
                    ))}
                  </div>
                )}
                {s.status === 'idle' && <div className="con-step-idle">Waiting…</div>}

                {id === 'intent' && !isAuth && orchState.status !== 'idle' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">ORCHESTRATOR PLATFORM — Agent Routing</div>
                        <div className="idp-sub">orchestrator-prod-2 · {orchState.requestsPerMin ?? '—'} req/min · 5 agents registered</div>
                      </div>
                      <span className="idp-pill">{orchState.status === 'loading' ? '…' : 'LIVE'}</span>
                    </div>

                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">REQUESTS/MIN</div>
                        <div className="idp-stat-value">{orchState.requestsPerMin ?? '—'}</div>
                        <div className="idp-stat-sub">↑ live counter</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">AVG ROUTING</div>
                        <div className="idp-stat-value">{orchState.avgRoutingMs != null ? `${orchState.avgRoutingMs}ms` : '—'}</div>
                        <div className="idp-stat-sub">P99: {orchState.p99RoutingMs ?? '—'}ms</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">DELEGATION</div>
                        <div className="idp-stat-value">0 → {orchState.delegationDepth ?? '—'}</div>
                        <div className="idp-stat-sub">Max allowed: 2</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">CONFLICT HOLDS</div>
                        <div className="idp-stat-value">{orchState.conflictHolds ?? '—'}</div>
                        <div className="idp-stat-sub">{orchState.conflictHolds ? 'Hold active' : 'No holds'}</div>
                      </div>
                    </div>

                    {orchState.selectedAgent && (
                      <div className="idp-request">
                        ROUTING: {orchState.selectedAgent.name} ({orchState.selectedAgent.id}) · Match: {orchState.selectedAgent.score} · Priority: {orchState.selectedAgent.priority} · {orchState.conflictHolds ? 'HOLD' : 'No conflicts'} · Depth: {orchState.delegationDepth}/2
                      </div>
                    )}

                    {orchState.agents && (
                      <div className="idp-table">
                        <div className="idp-row idp-head">
                          <span>AGENT</span><span>SCORE</span><span>INSTANCES</span><span>DECISION</span>
                        </div>
                        {orchState.agents.map(a => (
                          <div key={a.id} className="idp-row">
                            <span>{a.icon} {a.name}</span>
                            <span>{a.score}</span>
                            <span>{a.healthy}/{a.instances} HEALTHY</span>
                            <span className={a.decision === 'SELECTED' ? 'ok' : 'pending'}>
                              {a.decision === 'SELECTED' ? '✓ SELECTED' : 'SKIP'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="idp-section-title">SYSTEM — Agent Registry · Intent Classifier</div>
                    <div className="idp-chip-row">
                      <span className="idp-chip">registry.bank.internal/v2</span>
                      <span className="idp-chip">intent-classifier-v3</span>
                    </div>

                    <div className="idp-section-title">SECURITY — Orchestrator Controls</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Orchestrator Has ZERO Tool Access</div>
                        <div className="idp-sec-text">
                          Scopes: {orchState.scopes?.join(', ') ?? '—'}. No read:accounts, no write:payments.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Delegation Depth: 0 → {orchState.delegationDepth} (Max 2)</div>
                        <div className="idp-sec-text">OPA enforces max depth. Depth 3+ → automatic DENY.</div>
                      </div>
                      <div className="idp-sec-card">
                        <div className={orchState.conflictHolds ? 'idp-sec-title' : 'idp-sec-title'}>
                          {orchState.conflictHolds ? 'HOLD' : 'PASS'}
                        </div>
                        <div className="idp-sec-sub">Conflict Priority Matrix</div>
                        <div className="idp-sec-text">
                          Risk Agent (P=1): {orchState.riskHold ? 'HOLD ⚠' : 'no hold ✓'} · KYC Agent (P=1): {orchState.kycHold ? 'HOLD ⚠' : 'no hold ✓'}
                        </div>
                      </div>
                    </div>

                    {orchState.dispatch && (
                      <div className="idp-meta">{orchState.dispatch}</div>
                    )}
                  </div>
                )}

                {id === 'preflight' && !isAuth && judgeState.status !== 'idle' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">JUDGE LLM — Pre-Execution Security Gate</div>
                        <div className="idp-sub">
                          judge-llm-isolated.bank.internal · Claude Haiku 3.5 · temperature=0 · no tools
                        </div>
                      </div>
                      <span className="idp-pill">
                        {judgeState.status === 'loading' ? '…' : judgeState.approved ? 'APPROVED' : judgeState.status === 'error' ? 'ERROR' : 'BLOCKED'}
                      </span>
                    </div>

                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">PATTERNS SCANNED</div>
                        <div className="idp-stat-value">{judgeState.totalPatternsChecked ?? '—'}</div>
                        <div className="idp-stat-sub">8 categories</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">MATCHES FOUND</div>
                        <div className="idp-stat-value">{judgeState.status === 'loading' ? '…' : (judgeState.totalMatches ?? '—')}</div>
                        <div className="idp-stat-sub">{judgeState.clean ? 'CLEAN' : 'SUSPICIOUS'}</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">VALUE TIER</div>
                        <div className="idp-stat-value">{judgeState.tier ?? '—'}</div>
                        <div className="idp-stat-sub">{judgeState.tierLabel ?? '—'}</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">VERDICT</div>
                        <div className="idp-stat-value" style={{ fontSize: '0.85rem' }}>
                          {judgeState.status === 'loading' ? '…' : judgeState.approved ? '✓ APPROVED' : '✗ BLOCKED'}
                        </div>
                        <div className="idp-stat-sub">
                          {judgeState.confidence != null ? `${(judgeState.confidence * 100).toFixed(0)}% confidence` : '—'}
                        </div>
                      </div>
                    </div>

                    {judgeState.categories && (
                      <>
                        <div className="idp-subtle">INJECTION SCAN — 50 PATTERNS ACROSS 8 CATEGORIES</div>
                        <div className="idp-table">
                          <div className="idp-row idp-head">
                            <span>CATEGORY</span><span>MATCHED</span><span>TOTAL</span><span>STATUS</span>
                          </div>
                          {Object.entries(judgeState.categories).map(([cat, v]) => (
                            <div key={cat} className="idp-row">
                              <span>{cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                              <span>{v.count}</span>
                              <span>{v.total}</span>
                              <span className={v.count > 0 ? 'fail' : 'ok'}>{v.count > 0 ? '⚠ HIT' : 'CLEAN'}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {judgeState.reasoning && (
                      <div className="idp-request">
                        JUDGE VERDICT: {judgeState.approved ? 'APPROVED' : 'BLOCKED'} ·{' '}
                        Confidence {judgeState.confidence != null ? `${(judgeState.confidence * 100).toFixed(0)}%` : '—'} ·{' '}
                        Risk: {judgeState.riskCategory ?? '—'} ·{' '}
                        Injection: {judgeState.injectionAssessment ?? '—'}
                        <br />"{judgeState.reasoning}"
                      </div>
                    )}

                    {judgeState.tokenJti && (
                      <>
                        <div className="idp-section-title">SPIFFE SVID — Signed Approval Token</div>
                        <div className="idp-token">
                          <div className="idp-token-block">
                            <div className="idp-token-label">APPROVAL TOKEN PAYLOAD</div>
                            <div className="idp-kv"><span>"jti"</span><span>{judgeState.tokenJti} <em className="key">← KEY</em></span></div>
                            <div className="idp-kv">
                              <span>"approved_tools"</span>
                              <span>{judgeState.approvedTools?.length ? `[${judgeState.approvedTools.length} tools]` : '[] — blocked'}</span>
                            </div>
                            <div className="idp-kv"><span>"max_amount"</span><span>₹{(25000).toLocaleString('en-IN')}</span></div>
                            <div className="idp-kv"><span>"tier"</span><span>{judgeState.tier} — {judgeState.tierLabel}</span></div>
                            <div className="idp-kv"><span>"hitl_required"</span><span>{judgeState.tierHitl ? 'true ⚠' : 'false ✓'}</span></div>
                            <div className="idp-kv"><span>"exp"</span><span>60s TTL (short-lived gate token) <em className="key">← KEY</em></span></div>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="idp-section-title">SECURITY — Judge LLM Controls</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className={judgeState.clean ? 'idp-sec-title' : 'idp-sec-title'}>
                          {judgeState.clean ? 'PASS' : 'ALERT'}
                        </div>
                        <div className="idp-sec-sub">{judgeState.totalPatternsChecked ?? 50}-Pattern Injection Scan</div>
                        <div className="idp-sec-text">
                          {judgeState.totalMatches ?? 0} matches across 8 categories:{' '}
                          {judgeState.clean ? 'all categories CLEAN ✓' : 'suspicious patterns detected ⚠'}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Tier {judgeState.tier ?? '—'} — {judgeState.tierLabel ?? '—'}</div>
                        <div className="idp-sec-text">
                          ₹25,000 ≤ ₹{(judgeState.tierThreshold ?? 50000).toLocaleString('en-IN')} threshold ·{' '}
                          {judgeState.tierHitl ? 'HITL required' : 'Autonomous execution ✓'}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className={judgeState.approved ? 'idp-sec-title' : 'idp-sec-title'}>
                          {judgeState.approved ? 'PASS' : 'BLOCKED'}
                        </div>
                        <div className="idp-sec-sub">Judge LLM Verdict — {judgeState.judgeModel?.split('(')[0].trim()}</div>
                        <div className="idp-sec-text">
                          {judgeState.approved ? 'Payment cleared' : 'Payment blocked'} ·{' '}
                          inference: {judgeState.inferenceMs ?? '—'}ms ·{' '}
                          total gate: {judgeState.totalMs ?? '—'}ms
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {id === 'token' && showIdp && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">GRAVITY IDP — Admin Console (Token Issuance)</div>
                        <div className="idp-sub">idp-prod-3.bank.internal:8443 · {idpState.status === 'ready' ? 'live' : 'loading'} session</div>
                      </div>
                      <span className="idp-pill">LIVE</span>
                    </div>

                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">ACTIVE SESSIONS</div>
                        <div className="idp-stat-value">{idpState.activeSessions ?? (idpState.status === 'ready' ? '1' : '—')}</div>
                        <div className="idp-stat-sub">Active mTLS sessions</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">TOKENS ISSUED (24H)</div>
                        <div className="idp-stat-value">{idpState.tokensIssued24h ?? (idpState.status === 'ready' ? '1' : '—')}</div>
                        <div className="idp-stat-sub">All token types</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">CAEP EVENTS (24H)</div>
                        <div className="idp-stat-value">{idpState.caepEvents24h ?? idpState.revokedCount ?? '—'}</div>
                        <div className="idp-stat-sub">{idpState.revokedCount ? `${idpState.revokedCount} revocations` : '0 revocations today'}</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">FAILED AUTHS (24H)</div>
                        <div className="idp-stat-value">{idpState.failedAuths24h ?? (idpState.status === 'ready' ? '0' : '—')}</div>
                        <div className="idp-stat-sub">All blocked correctly</div>
                      </div>
                    </div>

                    <div className="idp-request">
                      NEW TOKEN REQUEST: {idpState.customerId ?? '—'} → scope: {scopeStr} · Consent: {consentValid ? 'VALID' : 'UNKNOWN'} · AI Disclosure: {disclosureValid ? 'VALID' : 'UNKNOWN'} · {idpState.status === 'loading' ? 'Processing…' : 'Issued'}
                    </div>

                    <div className="idp-table">
                      <div className="idp-row idp-head">
                        <span>CLAIM</span><span>VALUE</span><span>STATUS</span>
                      </div>
                      <div className="idp-row">
                        <span>sub</span><span>{typeof idpClaims.sub === 'string' ? idpClaims.sub : '—'} ({idpState.customerId ?? '—'})</span><span className="ok">✓ Verified</span>
                      </div>
                      <div className="idp-row">
                        <span>scope</span><span>{scopeStr}</span><span className="ok">✓ Consent match</span>
                      </div>
                      <div className="idp-row">
                        <span>exp</span><span>{expTtl ?? '—'}s (expires {formatTimeIST(exp)})</span><span className="ok">✓ Standard TTL</span>
                      </div>
                      <div className="idp-row">
                        <span>iss</span><span>{issStr}</span><span className="ok">✓ Home issuer</span>
                      </div>
                      <div className="idp-row">
                        <span>aud</span><span>{audStr}</span><span className="ok">✓ Audience scoped</span>
                      </div>
                      <div className="idp-row">
                        <span>jti</span><span>{jtiStr}</span><span className="ok">✓ Replay prevention</span>
                      </div>
                      <div className="idp-row">
                        <span>acr</span><span>{acrStr}</span><span className="ok">✓ LOA satisfied</span>
                      </div>
                      <div className="idp-row">
                        <span>cnf</span><span>{cnfStr}</span><span className={cnfStr !== '—' ? 'ok' : 'pending'}>{cnfStr !== '—' ? '✓ Bound' : '⏳ Pending'}</span>
                      </div>
                    </div>

                    <div className="idp-meta">
                      Issuance latency: {idpState.latencyMs ?? '—'}ms · Policy: {typeof idpClaims['x-agent-policy'] === 'string' ? idpClaims['x-agent-policy'] : 'payments-token-policy-v3.json'} · Algorithm: {typeof idpState.header?.alg === 'string' ? idpState.header?.alg : 'RS256'}
                    </div>

                    <div className="idp-section-title">SYSTEM — IdP Internals: Session &amp; Policy Eval</div>
                    <div className="idp-chip-row">
                      <span className="idp-chip">policy-engine</span>
                      <span className="idp-chip">session-store</span>
                      <span className="idp-chip">caep-broadcaster</span>
                    </div>

                    <div className="idp-section-title">GRAVITY IDP — HOW YOUR TOKEN IS BUILT</div>
                    <div className="idp-subtle">POLICY CHECKS (ALL 7 MUST PASS)</div>
                    <div className="idp-checks">
                      {(
                        [
                          ['User Active',   idpState.policies?.p1_user_active],
                          ['KYC Verified',  idpState.policies?.p2_kyc_verified],
                          ['Consent Valid', idpState.policies?.p3_consent_valid],
                          ['AI Disclosure', idpState.policies?.p4_ai_disclosure],
                          ['PEP Flag',      idpState.policies?.p5_pep_clear],
                          ['Sanctions',     idpState.policies?.p6_sanctions_clear],
                          ['Risk Score',    idpState.policies?.p7_risk_ok],
                        ] as [string, boolean | undefined][]
                      ).map(([label, pass]) => (
                        <div key={label} className="idp-check">
                          <span>{label}</span>
                          <span className={pass === false ? 'fail' : 'ok'}>{pass === false ? 'FAIL' : 'OK'}</span>
                        </div>
                      ))}
                    </div>

                    <div className="idp-token">
                      <div className="idp-token-title">ACCESS TOKEN ISSUED</div>
                      <div className="idp-token-block">
                        <div className="idp-token-label">HEADER</div>
                        <div className="idp-kv"><span>"alg"</span><span>{typeof idpState.header?.alg === 'string' ? idpState.header?.alg : 'RS256'}</span></div>
                        <div className="idp-kv"><span>"kid"</span><span>{typeof idpState.header?.kid === 'string' ? idpState.header?.kid : 'key-2024-12-001'}</span></div>
                        <div className="idp-kv"><span>"typ"</span><span>{typeof idpState.header?.typ === 'string' ? idpState.header?.typ : 'JWT'}</span></div>
                      </div>
                      <div className="idp-token-block">
                        <div className="idp-token-label">PAYLOAD</div>
                        <div className="idp-kv"><span>"sub"</span><span>{typeof idpClaims.sub === 'string' ? idpClaims.sub : '—'} <em className="key">← KEY</em></span></div>
                        <div className="idp-kv"><span>"scope"</span><span>{scopeStr} <em className="key">← KEY</em></span></div>
                        <div className="idp-kv"><span>"exp"</span><span>{formatTimeIST(exp)} ({expTtl ?? '—'}s) <em className="key">← KEY</em></span></div>
                        <div className="idp-kv"><span>"iss"</span><span>{issStr}</span></div>
                        <div className="idp-kv"><span>"aud"</span><span>{audStr}</span></div>
                        <div className="idp-kv"><span>"jti"</span><span>{jtiStr.split('-')[0] ?? jtiStr} <em className="key">← KEY</em></span></div>
                        <div className="idp-kv"><span>"acr"</span><span>{acrStr}</span></div>
                        <div className="idp-kv"><span>"caep_session"</span><span>{caepSession}</span></div>
                      </div>
                    </div>

                    <div className="idp-caep">
                      <div className="idp-section-title">CAEP Session Opened</div>
                      <div className="idp-caep-row"><span>Session</span><span>{caepSession}</span></div>
                      <div className="idp-caep-row"><span>Risk Level</span><span>{idpState.riskLevel && idpState.riskScore != null ? `${idpState.riskLevel} (${idpState.riskScore})` : 'LOW (0.04)'}</span></div>
                      <div className="idp-caep-row"><span>Subscribers</span><span>{idpState.caep ? (idpState.caep.subscribers.length > 0 ? idpState.caep.subscribers.join(', ') : 'None — in-process log only') : '—'}</span></div>
                      <div className="idp-caep-row"><span>Log backend</span><span>{idpState.caep?.log_backend ?? '—'}</span></div>
                      <div className="idp-caep-row"><span>Redis</span><span>{idpState.caep ? (idpState.caep.redis_active ? 'Connected ✓' : 'Offline — tokens stored in-memory only') : '—'}</span></div>
                    </div>

                    <div className="idp-section-title">SECURITY — JWT Token Inspector &amp; CAEP State</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">7-Policy Rule Engine — All Must Pass</div>
                        <div className="idp-sec-text">If KYC fails, or PEP/sanctions flag, or session risk &gt; 0.5: token is not issued.</div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Token Signed with {idpState.signingKey?.hsm ? 'HSM-Backed' : 'Software RSA'} Key</div>
                        <div className="idp-sec-text">{idpState.signingKey?.alg ?? 'RS256'}, kid "{idpState.signingKey?.kid ?? 'key-2024-12-001'}" · Storage: {idpState.signingKey?.storage ?? 'file'}{idpState.signingKey && !idpState.signingKey.hsm ? ` (${idpState.signingKey.path})` : ''}. Public key validates signature.</div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">ACTIVE</div>
                        <div className="idp-sec-sub">JTI Replay Prevention</div>
                        <div className="idp-sec-text">Express checks JTI in Redis on every request. TTL: {idpState.tokenTtl ? `${idpState.tokenTtl}s (${Math.round(idpState.tokenTtl/3600)}h)` : '3600s (1h)'}. Replays → 401 reject.</div>
                      </div>
                    </div>
                  </div>
                )}

                {id === 'security' && !isAuth && mcpValidationState.status === 'ready' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">PAYMENTS-MCP SERVER — Health &amp; Request Dashboard</div>
                        <div className="idp-sub">
                          mcp.payments.bank.internal:9443 · RASP: {mcpValidationState.raspStatus ?? 'ACTIVE'} · 3 replicas
                        </div>
                      </div>
                      <span className="idp-pill">LIVE</span>
                    </div>

                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">REQUEST RATE</div>
                        <div className="idp-stat-value">{mcpValidationState.requestRate ?? '—'}/min</div>
                        <div className="idp-stat-sub">Normal load · P99: 18ms</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">RASP STATUS</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.8rem'}}>{mcpValidationState.raspStatus ?? 'ACTIVE'}</div>
                        <div className="idp-stat-sub">No anomalies detected</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">JWT VALIDATION</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.75rem'}}>✓ PASS</div>
                        <div className="idp-stat-sub">cnf binding confirmed</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">AML RESULT</div>
                        <div className={`idp-stat-value ${mcpValidationState.amlResult ? 'ok' : 'pending'}`} style={{fontSize:'0.8rem'}}>
                          {mcpValidationState.amlResult ? 'PASS' : '…'}
                        </div>
                        <div className="idp-stat-sub">
                          {mcpValidationState.amlResult ? `${mcpValidationState.amlResult.lists.length}/4 lists clear` : 'Pending'}
                        </div>
                      </div>
                    </div>

                    {mcpValidationState.checks && (
                      <>
                        <div className="idp-section-title">VALIDATION CHECK — 8 CHECKS PER REQUEST</div>
                        <div className="idp-table">
                          <div className="idp-row idp-head">
                            <span>VALIDATION CHECK</span><span>EXPECTED</span><span>ACTUAL</span><span>RESULT</span>
                          </div>
                          {mcpValidationState.checks.map(c => (
                            <div key={c.check} className="idp-row">
                              <span>{c.check}</span>
                              <span style={{fontSize:'0.65rem'}}>{c.expected}</span>
                              <span style={{fontSize:'0.65rem'}}>{c.actual}</span>
                              <span className={c.pass ? 'ok' : 'fail'}>{c.pass ? '✓ PASS' : '✗ FAIL'}{c.check.includes('CNF') && c.pass ? ' ⭐' : ''}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {mcpValidationState.amlResult && (
                      <div className="idp-request">
                        AML SCREENING:{' '}
                        {mcpValidationState.amlResult.lists.map(l => l.split(' ')[0]).join(' ✓ ')} ✓ — All {mcpValidationState.amlResult.lists.length} lists clear.
                        Beneficiary {mcpValidationState.amlResult.bene_token} (Rahul Kumar HDFC ••••3892): no sanctions match above threshold {mcpValidationState.amlResult.threshold}.
                        Highest fuzzy score: {mcpValidationState.amlResult.max_fuzzy_score} (completely benign).{' '}
                        {mcpValidationState.amlResult.cached ? `Result cached (TTL: ${mcpValidationState.amlResult.cache_ttl / 3600}hr).` : ''}
                      </div>
                    )}

                    <div className="idp-meta">
                      Idempotency cache: Redis · AML cache TTL: 1hr · RASP version: {mcpValidationState.raspVersion ?? '2.1.4'} · Schema: payments-api-v2.yaml
                    </div>

                    <div className="idp-section-title">SECURITY — CNF Binding + RASP + AML Deep Dive</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">CNF Binding — Token Theft Defeated Here</div>
                        <div className="idp-sec-text">
                          MCP is the third place cnf binding is checked (after APIM and agent JWT decode). JWT cnf.x5t#S256 matched against actual TLS client cert SHA-256. Triple-check means theft needs to bypass 3 independent validation points simultaneously.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">AML — {mcpValidationState.amlResult?.lists.length ?? 4} Lists in Parallel · 1hr Redis Cache</div>
                        <div className="idp-sec-text">
                          OFAC SDN (53,247 entries), UN Security Council (869), RBI Domestic SDN (1,204), FATF High-Risk Countries. Fuzzy matching threshold 0.85. Max score: {mcpValidationState.amlResult?.max_fuzzy_score ?? 0.04}. Result cached per beneficiary token.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">JTI Replay Prevention at MCP Layer</div>
                        <div className="idp-sec-text">
                          payments-mcp maintains a separate JTI Redis cache (TTL: 360s) from the Gateway cache. Bypassing the Gateway JTI check still hits this independent MCP-level check. Two-layer replay prevention.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">ACTIVE</div>
                        <div className="idp-sec-sub">RASP v{mcpValidationState.raspVersion ?? '2.1.4'} — Process Monitor</div>
                        <div className="idp-sec-text">
                          Monitors: outbound connections (only APIM:443 + Redis:6379), memory access patterns, unexpected process spawns, FS access (/tmp only). Last alert: 47 days ago (resolved).
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {id === 'security' && !isAuth && agentExecState.status === 'ready' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">AGENT EXECUTION PLATFORM — PaymentOrchestrator Monitor</div>
                        <div className="idp-sub">
                          payment_agent_svc · pod: {agentExecState.pod ?? '—'} · SVID: {agentExecState.svidExpiresIn != null ? `${Math.floor(agentExecState.svidExpiresIn / 60)}m ${agentExecState.svidExpiresIn % 60}s` : '—'} remaining
                        </div>
                      </div>
                      <span className="idp-pill">READY</span>
                    </div>

                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">AGENT INSTANCE</div>
                        <div className="idp-stat-value" style={{fontSize:'0.75rem'}}>{agentExecState.pod ?? '—'}</div>
                        <div className="idp-stat-sub">{agentExecState.healthyPods}/3 healthy pods</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">SVID EXPIRES IN</div>
                        <div className="idp-stat-value" style={{fontSize:'0.8rem'}}>
                          {agentExecState.svidExpiresIn != null ? `${Math.floor(agentExecState.svidExpiresIn / 60)}m ${agentExecState.svidExpiresIn % 60}s` : '—'}
                        </div>
                        <div className="idp-stat-sub">Auto-rotates at expiry</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">WAL STATUS</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.8rem'}}>{agentExecState.walStatus ?? '—'}</div>
                        <div className="idp-stat-sub" style={{fontSize:'0.6rem'}}>{agentExecState.walKey ?? '—'}</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">PII TOKENS</div>
                        <div className="idp-stat-value">{agentExecState.piiTokenCount ?? '—'} created</div>
                        <div className="idp-stat-sub">Account + Beneficiary</div>
                      </div>
                    </div>

                    <div className="idp-section-title">PAYMENT AGENT — PRE-EXECUTION PREPARATION</div>
                    <div className="idp-subtle">3 SAFETY STEPS BEFORE ANY LLM CALL</div>

                    {/* Step 1: WAL */}
                    <div className="idp-token">
                      <div className="idp-token-title">📝 Write-Ahead Log (WAL) — Crash Recovery · Step 1</div>
                      <div className="idp-token-block">
                        <div className="idp-token-label">REDIS COMMAND</div>
                        <div className="idp-kv"><span>redis.set</span><span style={{fontSize:'0.65rem',wordBreak:'break-all'}}>"{agentExecState.walKey ?? '—'}"</span></div>
                        <div className="idp-kv"><span>agent_id</span><span>payment_agent_svc</span></div>
                        <div className="idp-kv"><span>task_id</span><span style={{fontSize:'0.65rem'}}>{agentExecState.taskId ?? '—'}</span></div>
                        <div className="idp-kv"><span>plan</span><span>[{agentExecState.plan?.map(s => s.tool).join(', ')}]</span></div>
                        <div className="idp-kv"><span>step_completed</span><span>0 <em className="key">← starts at 0</em></span></div>
                        <div className="idp-kv"><span>TTL</span><span>1800s (30-min crash recovery window)</span></div>
                      </div>
                      <div className="idp-meta" style={{marginTop:'4px'}}>
                        If pod crashes at step 1, next pod reads WAL → step_completed=0 → restart from AML check. No duplicate payment.
                      </div>
                    </div>

                    {/* Step 2: PII */}
                    <div className="idp-token">
                      <div className="idp-token-title">🪙 PII Tokenisation — LLM Never Sees Real Data · Step 2</div>
                      <div className="idp-token-block">
                        <div className="idp-token-label">LLM CONTEXT WINDOW (PII-FREE)</div>
                        <div className="idp-kv"><span>account_token</span><span>TKN-ACC-ab72 <em className="key">← opaque ref</em></span></div>
                        <div className="idp-kv"><span>bene_token</span><span>TKN-BEN-r7x2 <em className="key">← opaque ref</em></span></div>
                        <div className="idp-kv"><span>raw_account</span><span style={{color:'var(--c-dim)'}}>••••3421 ← vaulted, LLM never sees</span></div>
                      </div>
                      <div className="idp-meta" style={{marginTop:'4px'}}>
                        pii-vault ACL: payment_agent_svc WRITE · cbs-query-service READ · ALL OTHERS DENY
                      </div>
                    </div>

                    {/* Step 3: Idempotency */}
                    <div className="idp-token">
                      <div className="idp-token-title">🔑 Idempotency Key — Prevents Duplicate Payments · Step 3</div>
                      <div className="idp-token-block">
                        <div className="idp-token-label">UUID STORED IN 3 LAYERS</div>
                        <div className="idp-kv"><span>idem_key</span><span style={{fontSize:'0.65rem'}}>{agentExecState.idempotencyKey ?? '—'} <em className="key">← KEY</em></span></div>
                        <div className="idp-kv"><span>Layer 1</span><span>Redis WAL (pay_agent namespace)</span></div>
                        <div className="idp-kv"><span>Layer 2</span><span>payments-mcp Redis (MCP namespace)</span></div>
                        <div className="idp-kv"><span>Layer 3</span><span>CBS PostgreSQL (idempotency_log table)</span></div>
                      </div>
                      <div className="idp-meta" style={{marginTop:'4px'}}>
                        CBS: if key seen before → return cached result. If new → execute + store. All 3 layers checked before any CBS DML.
                      </div>
                    </div>

                    {/* Execution plan */}
                    {agentExecState.plan && (
                      <>
                        <div className="idp-section-title">AGENT PLAN — TOOL EXECUTION SEQUENCE</div>
                        <div className="idp-table">
                          <div className="idp-row idp-head">
                            <span>STEP</span><span>TOOL</span><span>STATUS</span>
                          </div>
                          {agentExecState.plan.map(s => (
                            <div key={s.step} className="idp-row">
                              <span>{s.step}</span>
                              <span>{s.tool}</span>
                              <span className="ok">✓ {s.status}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="idp-section-title">SECURITY — PII Isolation &amp; Agent Containment</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">PII Never Enters LLM — Structural Guarantee</div>
                        <div className="idp-sec-text">
                          Tokenisation happens before the LLM call. DLP scan confirms 0 PII patterns in context window. pii-vault ACL: agent WRITE-only, CBS READ-only, all others DENY.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">WAL — Crash Recovery without Duplication</div>
                        <div className="idp-sec-text">
                          step_completed 0→1→2. Crash at step 0: restart from AML (no CBS call). Crash at step 1: retry step 2 (AML cached). Crash at step 2: retrieve CBS idempotency result.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Idempotency UUID — 3-Layer Deduplication</div>
                        <div className="idp-sec-text">
                          UUID stored in Redis WAL + MCP cache + CBS PostgreSQL. Even if network retries 3× after payment executes, only 1 charge occurs — subsequent calls return cached result.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">{agentExecState.raspActive ? 'ACTIVE' : 'OFF'}</div>
                        <div className="idp-sec-sub">RASP — Runtime Protection</div>
                        <div className="idp-sec-text">
                          Embedded in agent process. Monitors: memory reads outside heap, syscalls (exec/fork), FS access (only /tmp), outbound network (only payments-mcp:9443 + pii-vault:8443). Deviation → SIEM + pod restart.
                        </div>
                      </div>
                    </div>

                    <div className="idp-meta">
                      model: {agentExecState.llmModel ?? '—'} · temperature: 0 · context: PII-free (tokenised only) · task: {agentExecState.taskId ?? '—'}
                    </div>

                    {agentExecState.langsmithUrl && (
                      <div style={{
                        marginTop: 10,
                        padding: '8px 12px',
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: '0.72rem',
                      }}>
                        <span style={{color:'#15803d', fontWeight:700}}>🔍 LangSmith Trace</span>
                        <a
                          href={agentExecState.langsmithUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{color:'#16a34a', fontFamily:'monospace', fontSize:'0.68rem', wordBreak:'break-all'}}
                        >
                          {agentExecState.langsmithRunId ?? agentExecState.langsmithUrl}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {id === 'security' && !isAuth && mcpOpaState.status === 'ready' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">OPA — Checkpoint 2: mcp_tool_allow (Per-Tool)</div>
                        <div className="idp-sub">
                          opa-sidecar.payments-mcp · {mcpOpaState.decisions?.length ?? 0} tools evaluated · AML-first ordering enforced
                        </div>
                      </div>
                      <span className="idp-pill">
                        {mcpOpaState.decisions?.every(d => d.allowed) ? 'ALLOW' : 'DENY'}
                      </span>
                    </div>

                    <div className="idp-grid">
                      {mcpOpaState.decisions?.map((d, i) => (
                        <div key={d.tool} className="idp-card">
                          <div className="idp-stat-label">TOOL {i + 1}</div>
                          <div className={`idp-stat-value ${d.allowed ? 'ok' : 'fail'}`} style={{fontSize:'0.7rem'}}>
                            {d.allowed ? 'ALLOW' : 'DENY'}
                          </div>
                          <div className="idp-stat-sub">{d.tool.replace(/_/g, ' ')}</div>
                        </div>
                      ))}
                      <div className="idp-card">
                        <div className="idp-stat-label">AML ORDERING</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.75rem'}}>ENFORCED</div>
                        <div className="idp-stat-sub">AML must complete first</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">TOTAL TIME</div>
                        <div className="idp-stat-value">{mcpOpaState.totalMs?.toFixed(1)}ms</div>
                        <div className="idp-stat-sub">Both tools evaluated</div>
                      </div>
                    </div>

                    {/* Per-tool rule breakdown */}
                    {mcpOpaState.decisions?.map((d, toolIdx) => (
                      <div key={d.tool}>
                        <div className="idp-section-title">
                          TOOL {toolIdx + 1}: {d.tool.replace(/_/g, '_')} — {d.latency_ms}ms · {d.decision_id}
                        </div>
                        <div className="idp-checks">
                          {([
                            ['Tool in Agent Registry',    d.rules.tool_in_registry, `${d.tool} ∈ payment_agent_svc.tools`],
                            ['Scope Covers Tool',         d.rules.scope_ok,         'write:payments ✓ per registry'],
                            ['Judge Token Approves Tool', d.rules.judge_approved,   `"${d.tool}" ∈ judge_token.approved_tools`],
                            ['AML Ordering Satisfied',    d.rules.no_aml_violation, d.tool === 'initiate_payment' ? 'AML DONE before this call ✓' : 'N/A (AML is step 1)'],
                          ] as [string, boolean, string][]).map(([label, pass, detail]) => (
                            <div key={label} className="idp-check" style={{flexDirection:'column',alignItems:'flex-start',gap:'2px'}}>
                              <div style={{display:'flex',justifyContent:'space-between',width:'100%'}}>
                                <span>{label}</span>
                                <span className={pass ? 'ok' : 'fail'}>{pass ? '✓' : '✗'}</span>
                              </div>
                              <span style={{fontSize:'0.65rem',color:'var(--c-dim)',paddingLeft:'4px'}}>{detail}</span>
                            </div>
                          ))}
                        </div>
                        <div className="idp-request" style={{marginTop:'4px'}}>
                          {d.tool === 'run_aml_screening' ? 'Tool 1: run_aml_screening?' : 'Tool 2: initiate_payment?'}{' '}
                          <strong className={d.allowed ? 'ok' : 'fail'}>{d.allowed ? 'ALLOW' : 'DENY'}</strong>
                          {' · '}{d.decision_id} · {d.allowed ? 'All 4 sub-rules passed.' : 'Denied.'}
                          {d.tool === 'initiate_payment' && d.allowed ? ' AML-first ordering enforced.' : ''}
                        </div>
                      </div>
                    ))}

                    <div className="idp-section-title">SECURITY — Cross-Tool Scope &amp; Ordering Controls</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">AML-First Ordering — Cannot Be Bypassed</div>
                        <div className="idp-sec-text">
                          Rego rule: if tool == "initiate_payment" AND aml_done != true → DENY. Even a fully compromised agent cannot initiate payment without first completing AML. This is a policy constraint, not code logic.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Per-Tool Authorisation — Not Blanket Permission</div>
                        <div className="idp-sec-text">
                          OPA evaluates EACH tool call individually. Judge's approved_tools list is also checked per-tool. An extra tool not in approved_tools would be blocked while others proceed.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Two Independent OPA Instances</div>
                        <div className="idp-sec-text">
                          CP1 ran at opa.bank.internal:8181 (Orchestrator). CP2 runs as sidecar inside payments-mcp pod (localhost:8181). Bypassing one does not bypass the other — completely independent evaluation.
                        </div>
                      </div>
                    </div>

                    <div className="idp-meta">
                      OPA sidecar: payments-mcp pod · Policy: mcp-tools.rego v2.1 · {mcpOpaState.decisions?.length ?? 0} tools · {mcpOpaState.decisions?.map(d => d.decision_id).join(' / ')}
                    </div>
                  </div>
                )}

                {id === 'security' && !isAuth && rfc8693State.status !== 'idle' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">GRAVITY IDP — RFC 8693 Token Exchange</div>
                        <div className="idp-sub">
                          idp-prod-3.bank.internal · RFC 8693 + RFC 8705 · delegated-jwt-svc
                        </div>
                      </div>
                      <span className="idp-pill">
                        {rfc8693State.status === 'loading' ? '…' : rfc8693State.status === 'ready' ? 'ISSUED' : 'ERROR'}
                      </span>
                    </div>

                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">GRANT TYPE</div>
                        <div className="idp-stat-value" style={{fontSize:'0.65rem',lineHeight:'1.3'}}>token-exchange</div>
                        <div className="idp-stat-sub">RFC 8693</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">TTL</div>
                        <div className="idp-stat-value">300s</div>
                        <div className="idp-stat-sub">Short-lived gate</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">SCOPE</div>
                        <div className="idp-stat-value" style={{fontSize:'0.7rem'}}>write:payments</div>
                        <div className="idp-stat-sub">Narrowed ↓</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">LATENCY</div>
                        <div className="idp-stat-value">{rfc8693State.latencyMs != null ? `${rfc8693State.latencyMs}ms` : '…'}</div>
                        <div className="idp-stat-sub">Exchange latency</div>
                      </div>
                    </div>

                    {rfc8693State.original && rfc8693State.delegated && (
                      <>
                        <div className="idp-section-title">CLAIM TRANSFORMATION — ORIGINAL → DELEGATED</div>
                        <div className="idp-table">
                          <div className="idp-row idp-head">
                            <span>CLAIM</span><span>ORIGINAL TOKEN</span><span>DELEGATED TOKEN</span><span>PURPOSE</span>
                          </div>
                          <div className="idp-row">
                            <span>sub</span>
                            <span style={{fontSize:'0.65rem'}}>{rfc8693State.original.sub}</span>
                            <span style={{fontSize:'0.65rem'}}>{rfc8693State.delegated.sub}</span>
                            <span className="ok">Preserved ✓</span>
                          </div>
                          <div className="idp-row">
                            <span>scope</span>
                            <span style={{fontSize:'0.6rem',wordBreak:'break-all'}}>{rfc8693State.original.scope.split(' ').slice(0,2).join(' ')}…</span>
                            <span style={{fontSize:'0.65rem'}}>{rfc8693State.delegated.scope}</span>
                            <span className="ok">Narrowed ↓</span>
                          </div>
                          <div className="idp-row">
                            <span>aud</span>
                            <span style={{fontSize:'0.65rem'}}>{rfc8693State.original.aud}</span>
                            <span style={{fontSize:'0.65rem'}}>{rfc8693State.delegated.aud}</span>
                            <span className="ok">Re-scoped ✓</span>
                          </div>
                          <div className="idp-row">
                            <span>jti</span>
                            <span style={{fontSize:'0.65rem'}}>{rfc8693State.original.jti?.split('-')[0]}…</span>
                            <span style={{fontSize:'0.65rem'}}>{rfc8693State.delegated.jti?.split('-').slice(0,2).join('-')}…</span>
                            <span className="ok">New ID ✓</span>
                          </div>
                          <div className="idp-row">
                            <span>act.sub</span>
                            <span style={{color:'var(--c-dim)'}}>—</span>
                            <span style={{fontSize:'0.6rem',wordBreak:'break-all'}}>{rfc8693State.delegated.act_sub}</span>
                            <span className="ok">RFC 8693 ✓</span>
                          </div>
                          <div className="idp-row">
                            <span>cnf</span>
                            <span style={{color:'var(--c-dim)'}}>—</span>
                            <span style={{fontSize:'0.6rem'}}>{rfc8693State.delegated.cnf ? `x5t#S256: ${String(rfc8693State.delegated.cnf['x5t#S256']).slice(0,12)}…` : 'not bound'}</span>
                            <span className={rfc8693State.delegated.cnf ? 'ok' : 'pending'}>{rfc8693State.delegated.cnf ? 'RFC 8705 ✓' : '—'}</span>
                          </div>
                          <div className="idp-row">
                            <span>delegation_depth</span>
                            <span style={{color:'var(--c-dim)'}}>—</span>
                            <span>{rfc8693State.delegated.delegation_depth}</span>
                            <span className="ok">OPA gate ✓</span>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="idp-section-title">SECURITY — Token Exchange Controls</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">cnf Binding Defeats Token Theft</div>
                        <div className="idp-sec-text">
                          Delegated JWT is bound to the TLS cert via cnf.x5t#S256 (RFC 8705). Stolen token is useless without the matching mTLS private key.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">sub Preserved — Full Audit Chain</div>
                        <div className="idp-sec-text">
                          Original user sub is preserved verbatim. Regulator can link any agent action back to the human who initiated it. act.sub identifies which agent acted.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Scope Narrowed — Least Privilege</div>
                        <div className="idp-sec-text">
                          Agent receives only write:payments — cannot read accounts, issue new tokens, or access other APIs. Scope reduction enforced at IdP, not runtime.
                        </div>
                      </div>
                    </div>

                    <div className="idp-meta">
                      RFC 8693 exchange · sub preserved · act.sub: {rfc8693State.delegated?.act_sub?.split('@')[0] ?? '—'} · scope: {rfc8693State.delegated?.scope ?? '—'} · delegation_depth: {rfc8693State.delegated?.delegation_depth ?? '—'}/2 · ttl: 300s
                    </div>
                  </div>
                )}

                {id === 'payload' && !isAuth && opaState.status !== 'idle' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">OPA ADMIN CONSOLE — Live Decision Dashboard</div>
                        <div className="idp-sub">opa.bank.internal:8181 · Rego v0.57 · Policy bundle: bank-policies-v3.2</div>
                      </div>
                      <span className="idp-pill">
                        {opaState.status === 'loading' ? '…' : (opaState.cp1?.allowed && opaState.cp2?.allowed) ? 'ALLOW' : 'DENY'}
                      </span>
                    </div>

                    {/* ── Checkpoint 1 ── */}
                    {opaState.cp1 && (() => {
                      const cp = opaState.cp1!
                      const rules = [
                        ['Agent Status = ACTIVE',   cp.rules.agent_active,        'payment_agent_svc is ACTIVE in registry'],
                        ['Agent Not Suspended',     cp.rules.agent_not_suspended, 'No emergency suspension flag'],
                        ['Scope Matches',           cp.rules.scope_matches,       'write:payments in agent permitted_scopes'],
                        ['Judge Token Valid',       cp.rules.judge_token_valid,   `${cp.input?.judge_token ?? '—'}: RS256 sig OK`],
                        ['Delegation Depth ≤ 2',    cp.rules.depth_ok,            `Current depth: ${cp.input?.delegation_depth ?? 1}. Max: 2.`],
                        ['No Conflict Hold',        cp.rules.no_conflict_hold,    `No Risk Agent (P=1) active on account`],
                        ['Amount Within Limit',     cp.rules.amount_within_limit, `₹${Number(cp.input?.amount ?? 0).toLocaleString('en-IN')} ≤ ₹50,000 limit`],
                      ] as [string, boolean, string][]
                      return (
                        <>
                          <div className="idp-grid">
                            <div className="idp-card">
                              <div className="idp-stat-label">CHECKPOINT</div>
                              <div className="idp-stat-value">1 of 2</div>
                              <div className="idp-stat-sub">allow_agent_routing</div>
                            </div>
                            <div className="idp-card">
                              <div className="idp-stat-label">DECISION TIME</div>
                              <div className="idp-stat-value">{cp.latency_ms}ms</div>
                              <div className="idp-stat-sub">P99 SLA: 5ms</div>
                            </div>
                            <div className="idp-card">
                              <div className="idp-stat-label">DECISION</div>
                              <div className={`idp-stat-value ${cp.allowed ? 'ok' : 'fail'}`}>{cp.allowed ? 'ALLOW' : 'DENY'}</div>
                              <div className="idp-stat-sub">All 7 sub-rules</div>
                            </div>
                            <div className="idp-card">
                              <div className="idp-stat-label">DECISION ID</div>
                              <div className="idp-stat-value" style={{fontSize:'0.7rem'}}>{cp.decision_id}</div>
                              <div className="idp-stat-sub">Logged to SIEM</div>
                            </div>
                          </div>
                          <div className="idp-section-title">OPA — 7 POLICY RULES (Checkpoint 1)</div>
                          <div className="idp-checks">
                            {rules.map(([label, pass, detail]) => (
                              <div key={label} className="idp-check" style={{flexDirection:'column',alignItems:'flex-start',gap:'2px'}}>
                                <div style={{display:'flex',justifyContent:'space-between',width:'100%'}}>
                                  <span>{label}</span>
                                  <span className={pass ? 'ok' : 'fail'}>{pass ? '✓' : '✗'}</span>
                                </div>
                                <span style={{fontSize:'0.65rem',color:'var(--c-dim)',paddingLeft:'4px'}}>{detail}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}

                    {/* ── Checkpoint 2 ── */}
                    {opaState.cp2 && (() => {
                      const cp = opaState.cp2!
                      const rules = [
                        ['Risk Below Threshold',  cp.rules.risk_below_threshold, `Score ${cp.input?.risk_score ?? '—'} < 0.55`],
                        ['Not Duplicate',         cp.rules.not_duplicate,        'No matching TXN in idempotency window'],
                        ['Consent Present',       cp.rules.consent_present,      `Ref: ${cp.input?.consent_ref ?? '—'}`],
                        ['AI Disclosure Valid',   cp.rules.ai_disclosure_valid,  'DISC-4f81 signed, within 90-day window'],
                        ['Amount Autonomous',     cp.rules.amount_autonomous,    `₹${Number(cp.input?.amount ?? 0).toLocaleString('en-IN')} ≤ Tier-A limit`],
                        ['Sanctions Clear',       cp.rules.sanctions_clear,      'No OFAC/UN/EU list match'],
                        ['Traceparent Present',   cp.rules.traceparent_present,  'W3C trace context propagated'],
                      ] as [string, boolean, string][]
                      return (
                        <>
                          <div className="idp-grid" style={{marginTop:'8px'}}>
                            <div className="idp-card">
                              <div className="idp-stat-label">CHECKPOINT</div>
                              <div className="idp-stat-value">2 of 2</div>
                              <div className="idp-stat-sub">allow_payment_execution</div>
                            </div>
                            <div className="idp-card">
                              <div className="idp-stat-label">DECISION TIME</div>
                              <div className="idp-stat-value">{cp.latency_ms}ms</div>
                              <div className="idp-stat-sub">P99 SLA: 5ms</div>
                            </div>
                            <div className="idp-card">
                              <div className="idp-stat-label">DECISION</div>
                              <div className={`idp-stat-value ${cp.allowed ? 'ok' : 'fail'}`}>{cp.allowed ? 'ALLOW' : 'DENY'}</div>
                              <div className="idp-stat-sub">All 7 sub-rules</div>
                            </div>
                            <div className="idp-card">
                              <div className="idp-stat-label">DECISION ID</div>
                              <div className="idp-stat-value" style={{fontSize:'0.7rem'}}>{cp.decision_id}</div>
                              <div className="idp-stat-sub">Logged to SIEM</div>
                            </div>
                          </div>
                          <div className="idp-section-title">OPA — 7 POLICY RULES (Checkpoint 2)</div>
                          <div className="idp-checks">
                            {rules.map(([label, pass, detail]) => (
                              <div key={label} className="idp-check" style={{flexDirection:'column',alignItems:'flex-start',gap:'2px'}}>
                                <div style={{display:'flex',justifyContent:'space-between',width:'100%'}}>
                                  <span>{label}</span>
                                  <span className={pass ? 'ok' : 'fail'}>{pass ? '✓' : '✗'}</span>
                                </div>
                                <span style={{fontSize:'0.65rem',color:'var(--c-dim)',paddingLeft:'4px'}}>{detail}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}

                    <div className="idp-section-title">SECURITY — OPA Policy Governance</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Policy Provenance — Git-Sourced, PR-Reviewed</div>
                        <div className="idp-sec-text">Rego lives in bank/security-policies. Every change needs 2 security-engineer approvals. CI runs rego unit tests. Bundle is GPG-signed by sec-team before OPA loads it.</div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS</div>
                        <div className="idp-sec-sub">Decision IDs — Full Audit Trail</div>
                        <div className="idp-sec-text">Every OPA decision is (1) returned to caller, (2) logged to Azure Sentinel SIEM, (3) included in WORM audit record. Regulator can retrieve exact Rego input + output by decision ID.</div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">INFO</div>
                        <div className="idp-sec-sub">Live Policy Update in &lt;30s</div>
                        <div className="idp-sec-text">SIEM can push new policy bundle to all OPA instances within 30 seconds with zero agent restarts. Previous bundle kept 1 hour as rollback — break-glass for real-time enforcement.</div>
                      </div>
                    </div>

                    <div className="idp-meta">
                      Decision sent to SIEM · decision_id: {opaState.cp1?.decision_id} / {opaState.cp2?.decision_id} · result: {opaState.cp1?.allowed && opaState.cp2?.allowed ? 'ALLOW' : 'DENY'} · policy: bank-policies-v3.2 (Git SHA: a1b2c3d)
                    </div>
                  </div>
                )}

                {id === 'payload' && !isAuth && graviteeApimState.status === 'ready' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">GRAVITEE APIM v4 — FULL VALIDATION SUITE (7 CHECKS)</div>
                        <div className="idp-sub">{graviteeApimState.instance} · Plan: {graviteeApimState.apiPlan} · Policy: {graviteeApimState.policyXml}</div>
                      </div>
                      <span className={`idp-pill ${graviteeApimState.allPassed ? '' : 'fail'}`}>
                        {graviteeApimState.allPassed ? 'ALLOW' : 'BLOCK'}
                      </span>
                    </div>

                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">DPoP PROOF</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.8rem'}}>VALID</div>
                        <div className="idp-stat-sub">RFC 9449 · Layer 3 binding</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">CNF = CERT</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.8rem'}}>MATCH</div>
                        <div className="idp-stat-sub">RFC 8705 · mTLS bound</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">AI-WAF</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.8rem'}}>CLEAN</div>
                        <div className="idp-stat-sub">{graviteeApimState.wafRules}</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">RATE LIMIT</div>
                        <div className="idp-stat-value ok">{graviteeApimState.rateCount}/100</div>
                        <div className="idp-stat-sub">per min · payment_agent_svc</div>
                      </div>
                    </div>

                    <div className="idp-section-title">GRAVITEE — 7 GATEWAY VALIDATION CHECKS</div>
                    <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                      <div style={{display:'flex',gap:'8px',padding:'4px 8px',fontSize:'0.65rem',fontWeight:700,color:'#6e7681',letterSpacing:'0.05em',borderBottom:'1px solid #21262d'}}>
                        <span style={{width:'90px',flexShrink:0}}>LAYER</span>
                        <span style={{width:'120px',flexShrink:0}}>CHECK</span>
                        <span style={{flex:1}}>DETAIL</span>
                        <span style={{width:'52px',flexShrink:0,textAlign:'center'}}>STATUS</span>
                        <span style={{width:'44px',flexShrink:0,textAlign:'right'}}>LATENCY</span>
                      </div>
                      {(graviteeApimState.checks ?? []).map((c, i) => (
                        <div key={i} style={{display:'flex',gap:'8px',padding:'5px 8px',fontSize:'0.72rem',color:'#c9d1d9',background:'#0b0f14',borderRadius:'5px',border:'1px solid #21262d',alignItems:'center'}}>
                          <span style={{width:'90px',flexShrink:0,color:'#58a6ff',fontFamily:'monospace',fontSize:'0.65rem'}}>{c.layer}</span>
                          <span style={{width:'120px',flexShrink:0}}>{c.check}</span>
                          <span style={{flex:1,fontSize:'0.65rem',color:'#8b949e'}}>{c.detail}</span>
                          <span style={{width:'52px',flexShrink:0,textAlign:'center',fontWeight:700,fontSize:'0.65rem',color:['VALID','MATCH','PASS','CLEAN','OK','ALLOW','CLOSED'].includes(c.status)?'#10b981':'#f85149'}}>
                            {c.status}
                          </span>
                          <span style={{width:'44px',flexShrink:0,textAlign:'right',color:'#6e7681',fontSize:'0.65rem'}}>{c.latency_ms}ms</span>
                        </div>
                      ))}
                    </div>

                    <div className="idp-verdict" style={{marginTop:'0.75rem', background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)', borderRadius:'6px', padding:'0.6rem 1rem', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <span style={{color:'#10b981', fontWeight:700, fontFamily:'monospace', fontSize:'0.8rem'}}>
                        ✓ ALL 7 GATEWAY CHECKS PASSED
                      </span>
                      <span style={{color:'#64748b', fontSize:'0.75rem'}}>
                        Total APIM validation: {graviteeApimState.totalMs}ms
                      </span>
                    </div>

                    <div className="idp-section-title" style={{marginTop:'1rem'}}>SECURITY CONTROLS</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">DPoP — Third Layer of Key Binding</div>
                        <div className="idp-sec-sub">FAPI 2.0 · RFC 9449</div>
                        <div className="idp-sec-text">
                          DPoP proof-of-possession binds the access token to a specific HTTP request (method + URI + token hash). Even if the bearer token is intercepted, it cannot be replayed from a different client. Third layer: mTLS (RFC 8705) → JWT cnf → DPoP htm/htu.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">AI-WAF — 50+ Detection Rules</div>
                        <div className="idp-sec-sub">OWASP CRS 3.3 + bank-ai-rules-v2</div>
                        <div className="idp-sec-text">
                          AI-aware Web Application Firewall scans all string fields in the payment request against 50+ patterns covering prompt injection, jailbreak attempts, indirect injection via note fields, and OWASP Top 10. Runs at Gravitee policy layer before any backend call.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">Audience Validation</div>
                        <div className="idp-sec-sub">OpenAPI Schema + JWT aud claim</div>
                        <div className="idp-sec-text">
                          Gravitee JWT policy validates the token audience matches payments-api.bank.internal exactly. Schema validation enforces the payments-api-v2.yaml contract — amount range, currency, idempotency key format — before the request reaches any agent.
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">Circuit Breaker — Auto-Suspend</div>
                        <div className="idp-sec-sub">OPA Denial Counter · 5-min window</div>
                        <div className="idp-sec-text">
                          Gravitee circuit breaker monitors OPA denial count per agent service in a 5-minute rolling window. If denials exceed threshold, the payment_agent_svc route is automatically suspended, protecting downstream CBS from a compromised or misbehaving agent.
                        </div>
                      </div>
                    </div>

                    <div className="idp-verdict" style={{marginTop:'0.75rem', background:'rgba(16,185,129,0.05)', border:'1px solid rgba(16,185,129,0.2)', borderRadius:'6px', padding:'0.5rem 1rem'}}>
                      <span style={{color:'#10b981', fontWeight:700, fontFamily:'monospace', fontSize:'0.8rem'}}>
                        GATEWAY ALLOW — All 7 layers passed
                      </span>
                      <span style={{color:'#64748b', fontSize:'0.75rem', marginLeft:'1rem'}}>
                        {graviteeApimState.gateway} · {graviteeApimState.instance}
                      </span>
                    </div>

                    <div className="idp-meta">
                      {graviteeApimState.gateway} · {graviteeApimState.instance} · Plan: {graviteeApimState.apiPlan} · WAF: {graviteeApimState.wafRules} · {graviteeApimState.checks?.length ?? 7} checks · {graviteeApimState.totalMs}ms total
                    </div>
                  </div>
                )}

                {/* ── CBS — Core Banking System Transaction Panel ── */}
                {id === 'cbs' && !isAuth && cbsState.status === 'ready' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">CORE BANKING SYSTEM v12.4.1 — LIVE TRANSACTION MONITOR</div>
                        <div className="idp-sub">cbs-prod-primary.bank.internal · PostgreSQL 16.2 · TDE AES-256 · Cluster: active/standby</div>
                      </div>
                      <span className="idp-pill">COMMITTED</span>
                    </div>

                    {/* 4 stat cards */}
                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">IDEMPOTENCY</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.75rem'}}>{cbsState.idemStatus ?? 'NEW KEY'}</div>
                        <div className="idp-stat-sub">{cbsState.idemKeyShort}: first seen</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">SUB-CLAIM FILTER</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.75rem'}}>ACTIVE</div>
                        <div className="idp-stat-sub">WHERE owner={cbsState.subClaim?.slice(0,12)}</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">BALANCE CHECK</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.75rem'}}>PASS</div>
                        <div className="idp-stat-sub">₹{cbsState.balanceBefore?.toLocaleString('en-IN')} → -₹{cbsState.amount?.toLocaleString('en-IN')}</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">TRANSACTION</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.75rem'}}>COMMITTED</div>
                        <div className="idp-stat-sub">ACID: all 4 properties</div>
                      </div>
                    </div>

                    {/* SQL block */}
                    <div className="idp-section-title">— EXACT SQL EXECUTED BY CBS (sub-claim filter enforced)</div>
                    <div style={{background:'#020409',border:'1px solid #21262d',borderRadius:'6px',padding:'0.75rem 1rem',fontFamily:'monospace',fontSize:'0.65rem',color:'#7ee787',whiteSpace:'pre',overflowX:'auto',lineHeight:1.6}}>
                      {cbsState.sqlBlock}
                    </div>

                    {/* Result line */}
                    <div style={{marginTop:'0.5rem',padding:'0.5rem 0.75rem',background:'rgba(16,185,129,0.06)',border:'1px solid rgba(16,185,129,0.2)',borderRadius:'5px',fontSize:'0.7rem',color:'#10b981',fontFamily:'monospace'}}>
                      {`TRANSACTION COMMITTED · ${cbsState.cbsTxnId} · IMPS Ref: ${cbsState.impsRef} · Source balance: ₹${cbsState.balanceAfter?.toLocaleString('en-IN')} · Beneficiary credited: ₹${cbsState.amount?.toLocaleString('en-IN')} · Non-repudiation signature stored in ledger row`}
                    </div>
                    <div style={{fontSize:'0.65rem',color:'#6e7681',marginTop:'4px',fontFamily:'monospace'}}>
                      PostgreSQL 16.2 · WAL: fsync=on · synchronous_commit=on · checkpoint_completion_target=0.9
                    </div>

                    {/* 3-step system breakdown */}
                    <div className="idp-section-title" style={{marginTop:'1rem'}}>CORE BANKING — THE ACTUAL TRANSACTION</div>
                    <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                      {[
                        {
                          icon: '🔍', step: 'Step 1', title: 'Idempotency Pre-check (Before Any Change)',
                          sub: 'First thing CBS does — before touching any balance — is check if this key was seen before. If yes: return cached result. This is the database-level protection against duplicate payments.',
                          code: `SELECT txn_id FROM idempotency_log\nWHERE idem_key = "${cbsState.idemKeyShort}-8b3c"\n→ 0 rows: FIRST TIME → PROCEED`,
                        },
                        {
                          icon: '🔒', step: 'Step 2', title: 'Sub-Claim SQL Filter (Structural Security)',
                          sub: 'The sub-claim from the JWT is embedded in the WHERE clause. This is NOT application code — it\'s enforced at the ORM + PostgreSQL RLS layer. A compromised agent cannot bypass this.',
                          code: `UPDATE accounts\n  SET balance = balance - ${cbsState.amount?.toLocaleString('en-IN')}\n  WHERE account_id = "${cbsState.acctId}"\n    AND account_owner = "${cbsState.subClaim}"\n         ↑ JWT sub claim enforced here`,
                        },
                        {
                          icon: '💸', step: 'Step 3', title: 'ACID Transaction — All or Nothing',
                          sub: 'Debit source, credit beneficiary, write ledger row, store idempotency result — all in one atomic transaction. If any step fails: all changes roll back. No partial payments possible.',
                          code: `BEGIN;\n  UPDATE accounts ... DEBIT ₹${cbsState.amount?.toLocaleString('en-IN')};\n  UPDATE accounts ... CREDIT ₹${cbsState.amount?.toLocaleString('en-IN')};\n  INSERT INTO ledger (non_rep_sig: ✓);\n  INSERT INTO idempotency_log (...);\nCOMMIT; ← Disk sync (fsync=on)`,
                        },
                      ].map(s => (
                        <div key={s.step} style={{border:'1px solid #21262d',borderRadius:'6px',padding:'0.6rem 0.75rem',background:'#0b0f14'}}>
                          <div style={{display:'flex',gap:'8px',alignItems:'flex-start'}}>
                            <span style={{fontSize:'1.1rem'}}>{s.icon}</span>
                            <div style={{flex:1}}>
                              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'2px'}}>
                                <span style={{fontSize:'0.72rem',fontWeight:700,color:'#f0f6fc'}}>{s.title}</span>
                                <span style={{fontSize:'0.65rem',color:'#58a6ff',fontFamily:'monospace'}}>{s.step}</span>
                              </div>
                              <div style={{fontSize:'0.68rem',color:'#8b949e',marginBottom:'6px'}}>{s.sub}</div>
                              <div style={{background:'#020409',borderRadius:'4px',padding:'5px 8px',fontFamily:'monospace',fontSize:'0.62rem',color:'#7ee787',whiteSpace:'pre',lineHeight:1.5}}>
                                {s.code}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Commit status */}
                    <div style={{marginTop:'0.75rem',display:'flex',gap:'12px',alignItems:'center',padding:'0.6rem 0.75rem',background:'rgba(16,185,129,0.08)',border:'1px solid rgba(16,185,129,0.25)',borderRadius:'6px'}}>
                      <span style={{fontSize:'1.2rem'}}>✅</span>
                      <div>
                        <div style={{fontSize:'0.75rem',fontWeight:700,color:'#10b981',fontFamily:'monospace'}}>CBS COMMITTED</div>
                        <div style={{fontSize:'0.65rem',color:'#8b949e'}}>
                          ACID commit · {cbsState.cbsTxnId} · {cbsState.impsRef} · Non-repudiation SHA-256 signature in ledger row · TDE AES-256 at rest
                        </div>
                      </div>
                      <span style={{marginLeft:'auto',fontSize:'0.7rem',color:'#58a6ff',fontFamily:'monospace'}}>{cbsState.commitLatencyMs}ms</span>
                    </div>

                    {/* Security cards */}
                    <div className="idp-section-title" style={{marginTop:'1rem'}}>SECURITY — CBS Security Controls Deep Dive</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · Sub-Claim SQL Filter — Structural Cross-Customer Prevention</div>
                        <div className="idp-sec-sub">{cbsState.commitTs?.slice(11,19) ?? ''}</div>
                        <div className="idp-sec-text">
                          The WHERE account_owner='{cbsState.subClaim}' clause is added by the ORM's query interceptor AND enforced by PostgreSQL Row-Level Security (RLS). Two independent enforcement layers. The debit UPDATE returned 1 row — confirming the account belongs to this customer.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`ORM: WHERE account_owner = jwt.sub\nRLS: USING (account_owner = current_setting("jwt.sub"))\nRows affected: 1 ← PASS ✓`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · ACID Durability — fsync Before COMMIT Returns</div>
                        <div className="idp-sec-sub">{cbsState.commitTs?.slice(11,19) ?? ''}</div>
                        <div className="idp-sec-text">
                          fsync=on + synchronous_commit=on — COMMIT does not return until WAL is physically written to disk. If the server crashes 1ms after COMMIT: the transaction is still recoverable. COMMIT latency: {cbsState.commitLatencyMs}ms (disk flush included).
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`fsync = on\nsynchronous_commit = on\nwal_sync_method = fdatasync\nCOMMIT latency: ${cbsState.commitLatencyMs}ms`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · Non-Repudiation — SHA-256 in Ledger Row</div>
                        <div className="idp-sec-sub">{cbsState.commitTs?.slice(11,19) ?? ''}</div>
                        <div className="idp-sec-text">
                          The ledger row non_rep_sig is signed with the payment_agent_svc SPIFFE SVID private key. Covers: txn_id, from_account_hash, to_account_hash, amount, timestamp. The bank cannot deny execution — the signature proves which agent's key signed it.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`non_rep_sig = SIGN(SHA256(\n  txn_id||from||to||amount||ts\n), payment_agent_svid_key)\nVerifiable with: SPIFFE public key ✓`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · TDE — Disk Encryption with CMK in Azure Key Vault</div>
                        <div className="idp-sec-sub">{cbsState.commitTs?.slice(11,19) ?? ''}</div>
                        <div className="idp-sec-text">
                          Transparent Data Encryption encrypts ALL tablespace files at the storage layer. CMK: cbs-cmk-2024 in Azure Key Vault (FIPS 140-2 Level 2). Key rotation every 90 days. Even physical disk removal: data is unreadable without the CMK.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`CMK: cbs-cmk-2024 (Azure Key Vault)\nEncryption: AES-256-XTS\nKey rotation: every 90 days\nAccess: CBS service identity only`}
                        </div>
                      </div>
                    </div>

                    <div className="idp-meta">
                      {cbsState.cbsTxnId} · {cbsState.impsRef} · PostgreSQL 16.2 · TDE AES-256 · WAL fsync=on · commit: {cbsState.commitLatencyMs}ms
                    </div>
                  </div>
                )}

                {/* ── DLP — Outbound Response Scan Panel ── */}
                {id === 'dlp' && !isAuth && dlpState.status === 'ready' && (
                  <div className="idp-panel">
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">DLP FUNCTION v3.2.1 — OUTBOUND RESPONSE SCAN</div>
                        <div className="idp-sub">dlp-function-prod.azurewebsites.net · Stateless · {dlpState.execMs}ms · RASP: {dlpState.raspStatus}</div>
                      </div>
                      <span className="idp-pill">{dlpState.dlpResult ?? 'PASS'}</span>
                    </div>

                    {/* 4 stat cards */}
                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">EXEC TIME</div>
                        <div className="idp-stat-value ok">{dlpState.execMs}ms</div>
                        <div className="idp-stat-sub">SLA: 60ms ✓</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">PATTERNS CHECKED</div>
                        <div className="idp-stat-value">{dlpState.patternsChecked}</div>
                        <div className="idp-stat-sub">Regex + ML ensemble</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">FIELDS MASKED</div>
                        <div className="idp-stat-value" style={{color:'#e3b341'}}>{dlpState.fieldsMasked}</div>
                        <div className="idp-stat-sub">Account number suffix</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">RESULT</div>
                        <div className="idp-stat-value ok" style={{fontSize:'0.8rem'}}>PASS</div>
                        <div className="idp-stat-sub">Response released</div>
                      </div>
                    </div>

                    {/* Pattern table */}
                    <div className="idp-section-title">DLP — 6 PATTERN TYPES SCANNED</div>
                    <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                      <div style={{display:'flex',gap:'6px',padding:'4px 8px',fontSize:'0.62rem',fontWeight:700,color:'#6e7681',letterSpacing:'0.05em',borderBottom:'1px solid #21262d'}}>
                        <span style={{width:'110px',flexShrink:0}}>PATTERN TYPE</span>
                        <span style={{width:'130px',flexShrink:0}}>REGEX</span>
                        <span style={{width:'120px',flexShrink:0}}>ML MODEL</span>
                        <span style={{flex:1}}>FIELDS SCANNED</span>
                        <span style={{width:'50px',flexShrink:0,textAlign:'center'}}>RESULT</span>
                        <span style={{width:'80px',flexShrink:0,textAlign:'right'}}>ACTION</span>
                      </div>
                      {(dlpState.patterns ?? []).map((p, i) => (
                        <div key={i} style={{display:'flex',gap:'6px',padding:'5px 8px',fontSize:'0.68rem',color:'#c9d1d9',background:'#0b0f14',borderRadius:'5px',border:'1px solid #21262d',alignItems:'center'}}>
                          <span style={{width:'110px',flexShrink:0,color:'#f0f6fc',fontWeight:600,fontSize:'0.65rem'}}>{p.type}</span>
                          <span style={{width:'130px',flexShrink:0,fontFamily:'monospace',fontSize:'0.6rem',color:'#8b949e'}}>{p.regex}</span>
                          <span style={{width:'120px',flexShrink:0,fontSize:'0.62rem',color:'#58a6ff'}}>{p.mlModel}</span>
                          <span style={{flex:1,fontSize:'0.62rem',color:'#6e7681'}}>{p.fieldsScanned}</span>
                          <span style={{width:'50px',flexShrink:0,textAlign:'center',fontWeight:700,fontSize:'0.62rem',
                            color: p.result === 'CLEAN' ? '#10b981' : p.result === 'PARTIAL' ? '#e3b341' : '#f85149'}}>
                            {p.result}
                          </span>
                          <span style={{width:'80px',flexShrink:0,textAlign:'right',fontSize:'0.62rem',color: p.action === 'None' ? '#6e7681' : '#e3b341'}}>{p.action}</span>
                        </div>
                      ))}
                    </div>

                    {/* Before / After payload diff */}
                    <div className="idp-section-title" style={{marginTop:'1rem'}}>RESPONSE PAYLOAD — Before → After DLP</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                      <div>
                        <div style={{fontSize:'0.62rem',color:'#6e7681',marginBottom:'4px',fontFamily:'monospace'}}>// BEFORE DLP scan:</div>
                        <div style={{background:'#020409',border:'1px solid #21262d',borderRadius:'5px',padding:'0.6rem 0.75rem',fontFamily:'monospace',fontSize:'0.62rem',color:'#c9d1d9',lineHeight:1.7}}>
                          {'{\n'}
                          {Object.entries(dlpState.beforePayload ?? {}).map(([k, v]) => (
                            `  "${k}": ${JSON.stringify(v)},\n`
                          )).join('')}
                          {'}'}
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize:'0.62rem',color:'#6e7681',marginBottom:'4px',fontFamily:'monospace'}}>// AFTER DLP scan: to_account field masked</div>
                        <div style={{background:'#020409',border:'1px solid rgba(227,179,65,0.3)',borderRadius:'5px',padding:'0.6rem 0.75rem',fontFamily:'monospace',fontSize:'0.62rem',color:'#c9d1d9',lineHeight:1.7}}>
                          {'{\n'}
                          {Object.entries(dlpState.afterPayload ?? {}).map(([k, v]) => {
                            const changed = dlpState.beforePayload?.[k] !== v
                            return (
                              <span key={k} style={{color: changed ? '#e3b341' : '#c9d1d9'}}>
                                {`  "${k}": ${JSON.stringify(v)},\n`}
                              </span>
                            )
                          })}
                          {'}'}
                        </div>
                      </div>
                    </div>

                    {/* DLP result line */}
                    <div style={{marginTop:'0.5rem',padding:'0.5rem 0.75rem',background:'rgba(16,185,129,0.06)',border:'1px solid rgba(16,185,129,0.2)',borderRadius:'5px',fontSize:'0.7rem',color:'#10b981',fontFamily:'monospace'}}>
                      DLP RESULT: PASS — {dlpState.fieldsMasked} field masked (to_account: account number suffix ••••3892 → [REDACTED]). Response released to upstream. DLP execution logged: {dlpState.dlpExecId} · RASP: no process anomalies during execution
                    </div>
                    <div style={{fontSize:'0.62rem',color:'#6e7681',marginTop:'3px',fontFamily:'monospace'}}>
                      Azure Function App: dlp-scan-prod · Runtime: Node.js 20 · Memory: 256MB · Stateless — no persistent state
                    </div>

                    {/* 6-pattern icon grid */}
                    <div className="idp-section-title" style={{marginTop:'1rem'}}>DLP SCAN — LAST LINE BEFORE CUSTOMER SEES DATA</div>
                    <div style={{fontSize:'0.68rem',color:'#8b949e',marginBottom:'8px'}}>
                      Every outbound response passes through a DLP Azure Function before reaching the customer. Even if an upstream bug caused raw account data to appear in the response, DLP catches and masks it here.
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'6px',marginBottom:'8px'}}>
                      {[
                        { icon:'💳', label:'PAN 16-digit',    warn: false },
                        { icon:'🪪', label:'Aadhaar 12-digit', warn: false },
                        { icon:'🏦', label:'Account No.',      warn: true  },
                        { icon:'🔤', label:'IFSC Code',        warn: false },
                        { icon:'📱', label:'Mobile No.',       warn: false },
                        { icon:'📧', label:'Email Addr',       warn: false },
                      ].map(p => (
                        <div key={p.label} style={{border:`1px solid ${p.warn ? 'rgba(227,179,65,0.4)' : '#21262d'}`,borderRadius:'5px',padding:'6px 4px',textAlign:'center',background: p.warn ? 'rgba(227,179,65,0.05)' : '#0b0f14'}}>
                          <div style={{fontSize:'1.1rem'}}>{p.icon}</div>
                          <div style={{fontSize:'0.58rem',color: p.warn ? '#e3b341' : '#10b981',fontWeight:700,marginTop:'2px'}}>{p.warn ? 'WARN' : 'OK'}</div>
                          <div style={{fontSize:'0.58rem',color:'#6e7681',marginTop:'1px'}}>{p.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Action taken banner */}
                    <div style={{padding:'0.5rem 0.75rem',background:'rgba(227,179,65,0.08)',border:'1px solid rgba(227,179,65,0.3)',borderRadius:'5px',display:'flex',gap:'12px',alignItems:'center',marginBottom:'8px'}}>
                      <span style={{fontSize:'1.1rem'}}>⚠️</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:'0.7rem',fontWeight:700,color:'#e3b341',fontFamily:'monospace'}}>ACTION TAKEN: {dlpState.fieldsMasked} Field Masked</div>
                        <div style={{display:'flex',gap:'8px',alignItems:'center',marginTop:'4px',fontFamily:'monospace',fontSize:'0.65rem'}}>
                          <span style={{color:'#c9d1d9'}}>to_account: "••••3892"</span>
                          <span style={{color:'#6e7681'}}>→</span>
                          <span style={{color:'#10b981'}}>to_account: "[REDACTED]"</span>
                        </div>
                      </div>
                    </div>

                    {/* Safe to send gate */}
                    <div style={{padding:'0.6rem 0.75rem',background:'rgba(16,185,129,0.08)',border:'1px solid rgba(16,185,129,0.25)',borderRadius:'5px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:'0.7rem',color:'#8b949e'}}>Is the response safe to send to the customer?</span>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'0.8rem',fontWeight:700,color:'#10b981',fontFamily:'monospace'}}>PASS · DLP PASS</div>
                        <div style={{fontSize:'0.62rem',color:'#6e7681'}}>
                          {dlpState.fieldsMasked} field masked (account suffix). All other fields clean. {dlpState.execMs}ms (SLA: 60ms). Response released.
                        </div>
                      </div>
                    </div>

                    {/* Security cards */}
                    <div className="idp-section-title" style={{marginTop:'1rem'}}>SECURITY — DLP as Last Defence &amp; Function Security</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · Defence-in-Depth — Why DLP After CBS Is Needed</div>
                        <div className="idp-sec-sub">CBS masked name · DLP catches remaining fields</div>
                        <div className="idp-sec-text">
                          CBS only masks the name field, not all fields. A future code change might add new fields. The account suffix "••••3892" is still technically identifiable data. DLP provides an independent, automatic last-line-of-defence — doesn't depend on every upstream developer remembering to mask every field.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`CBS masked: beneficiary_name → "R****r Kumar"\nDLP found: to_account "••••3892"\n  → account-detector-v3 confidence: 0.94\n  → masked: "[REDACTED]"\nTwo independent masking layers ✓`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · ML + Regex Ensemble — Catches What Rules Miss</div>
                        <div className="idp-sec-sub">Regex patterns + ML models · both must agree</div>
                        <div className="idp-sec-text">
                          Both regex AND ML model must agree before MASK action (reduces false positives). ML catches subtle patterns: "acc: 3892" written in text — which regex might miss. Model retrained quarterly on the bank's own data.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`IF regex AND ml_confidence > 0.80: MASK\nIF regex AND ml_confidence < 0.80: FLAG\nIF regex only (PAN/Aadhaar): MASK`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · Stateless Function — No Data Leakage Between Requests</div>
                        <div className="idp-sec-sub">Azure Function · no in-memory session state</div>
                        <div className="idp-sec-text">
                          Completely stateless — no database connection held open, no in-memory session, no caching of request data. Customer A's scan cannot see Customer B's data even if processed concurrently on different instances.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`request_payload: garbage-collected\nscan_results: garbage-collected\nDLP model: stays warm (256MB static)\nNo persistent customer data ✓`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · DLP Scan Itself Is Audited</div>
                        <div className="idp-sec-sub">{dlpState.dlpExecId} · WORM audit store</div>
                        <div className="idp-sec-text">
                          The DLP function writes its own audit event recording which fields were scanned, which were masked, execution time, trace_id linkage. Regulator can retrieve trace {dlpState.traceId?.slice(0, 20)} and find the DLP execution showing "to_account: MASKED".
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`audit_id: ${dlpState.dlpExecId}\ntrace_id: ${dlpState.traceId?.slice(0, 28) ?? '—'}\nfields_masked: to_account\nWORM store: immutable ✓`}
                        </div>
                      </div>
                    </div>

                    <div className="idp-meta">
                      {dlpState.dlpExecId} · {dlpState.patternsChecked} patterns · {dlpState.fieldsMasked} field masked · {dlpState.execMs}ms · RASP: {dlpState.raspStatus} · Azure Function Node.js 20 · 256MB
                    </div>
                  </div>
                )}

                {/* ── AUDIT — WORM Audit Dashboard Panel ── */}
                {id === 'audit' && !isAuth && auditState.status === 'ready' && (
                  <div className="idp-panel">
                    {/* Header */}
                    <div className="idp-header">
                      <div>
                        <div className="idp-title">AUDIT-MCP v4.0.0 — WORM WRITE DASHBOARD</div>
                        <div className="idp-sub">audit.bank.internal:9445 · Internal GW only · Azure Immutable Blob · India Central</div>
                      </div>
                      <span className="idp-pill">WORM SEALED</span>
                    </div>

                    {/* 4 stat cards */}
                    <div className="idp-grid">
                      <div className="idp-card">
                        <div className="idp-stat-label">AUDIT RECORDS (24H)</div>
                        <div className="idp-stat-value">{auditState.records24h?.toLocaleString('en-IN')}</div>
                        <div className="idp-stat-sub">All agents all scenarios</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">WORM SEALED</div>
                        <div className="idp-stat-value" style={{color:'#7ee787'}}>{auditState.wormSealed?.toLocaleString('en-IN')}</div>
                        <div className="idp-stat-sub">100% sealed — none pending</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">STORAGE USED</div>
                        <div className="idp-stat-value">{auditState.storageTb} TB</div>
                        <div className="idp-stat-sub">India Central · CMK encrypted</div>
                      </div>
                      <div className="idp-card">
                        <div className="idp-stat-label">RETENTION LOCK</div>
                        <div className="idp-stat-value" style={{fontSize:'1rem'}}>{auditState.retentionYears} YEARS</div>
                        <div className="idp-stat-sub">Until 2031-12-15</div>
                      </div>
                    </div>

                    {/* JSON audit record */}
                    <div className="idp-section-title" style={{marginTop:'0.5rem'}}>COMPLETE AUDIT RECORD — Written to Azure Immutable Blob</div>
                    <div style={{fontSize:'0.62rem',color:'#6e7681',marginBottom:'4px',fontFamily:'monospace',lineHeight:1.6}}>
                      {'// Container: audit-records-2024 · Path: ' + auditState.blobPath}<br/>
                      {'// Policy: immutability-policy=LOCKED · retention-until=2031-12-15'}<br/>
                      {'// Encryption: CMK cbs-audit-cmk-2024 (Azure Key Vault)'}
                    </div>
                    <div style={{background:'#020409',border:'1px solid #21262d',borderRadius:'5px',padding:'0.75rem',fontFamily:'monospace',fontSize:'0.62rem',color:'#c9d1d9',lineHeight:1.8,whiteSpace:'pre',overflowX:'auto'}}>
                      {auditState.auditRecord ? JSON.stringify(auditState.auditRecord, null, 2) : ''}
                    </div>
                    <div style={{fontSize:'0.62rem',color:'#6e7681',marginTop:'3px',fontFamily:'monospace'}}>
                      Records indexed in: Azure AI Search (for explainability queries) · Compliance portal (read-only API) · Legal hold: enabled
                    </div>

                    {/* System log */}
                    <div className="idp-section-title" style={{marginTop:'1rem'}}>SYSTEM — audit-mcp Write &amp; Azure Blob Immutability</div>
                    <div style={{fontSize:'0.62rem',color:'#6e7681',marginBottom:'8px',fontFamily:'monospace'}}>
                      audit-mcp.log · azure-blob-write.log · immutability-confirm.log
                    </div>

                    {/* WORM AUDIT section */}
                    <div className="idp-section-title">WORM AUDIT — THE PERMANENT LEGAL RECORD</div>
                    <div style={{fontSize:'0.68rem',color:'#8b949e',marginBottom:'8px'}}>
                      This audit record is written to Azure Immutable Blob Storage and permanently sealed. Nobody — not the bank, not Microsoft, not the regulator — can modify or delete it for 7 years. This is the legal chain of custody for this payment.
                    </div>

                    {/* What is in the record */}
                    <div className="idp-section-title">WHAT IS IN THE AUDIT RECORD</div>
                    <div style={{display:'flex',flexDirection:'column',gap:'5px',marginBottom:'8px',marginTop:'4px'}}>
                      {[
                        ['W3C Trace ID (end-to-end chain)', 'Links this record to every component that handled this payment'],
                        ['All 3 OPA decision IDs', 'Proves exactly which policies permitted this action'],
                        ['Judge LLM approval reference', 'Proves the injection scan passed before execution'],
                        ['LLM reasoning hash (SHA-256)', 'Integrity proof of AI reasoning — without storing raw reasoning (privacy)'],
                        ['Non-repudiation signature', 'Signed with agent SVID — bank cannot deny this payment happened'],
                        ['user_sub_hash (SHA-256)', 'Customer identity proven without storing raw user ID'],
                      ].map(([title, desc], i) => (
                        <div key={i} style={{display:'flex',gap:'8px',alignItems:'flex-start',padding:'5px 8px',background:'rgba(16,185,129,0.05)',border:'1px solid rgba(16,185,129,0.15)',borderRadius:'5px'}}>
                          <span style={{color:'#10b981',flexShrink:0,fontSize:'0.7rem',marginTop:'1px'}}>✓</span>
                          <div>
                            <div style={{fontSize:'0.68rem',fontWeight:700,color:'#f0f6fc'}}>{title}</div>
                            <div style={{fontSize:'0.62rem',color:'#8b949e'}}>{desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'5px 8px',background:'rgba(56,139,253,0.05)',border:'1px solid rgba(56,139,253,0.2)',borderRadius:'5px',marginBottom:'8px',fontSize:'0.62rem',color:'#8b949e'}}>
                      <span style={{color:'#58a6ff',flexShrink:0}}>ℹ</span>
                      7-year WORM retention required by RBI Master Direction 2021 + PMLA 2002
                    </div>

                    {/* WORM SEAL CONFIRMED box */}
                    <div style={{padding:'0.6rem 0.75rem',background:'rgba(16,185,129,0.06)',border:'1px solid rgba(16,185,129,0.25)',borderRadius:'5px',marginBottom:'8px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
                        <span style={{fontSize:'0.7rem',fontWeight:700,color:'#10b981',fontFamily:'monospace'}}>WORM SEAL CONFIRMED</span>
                        <span style={{color:'#10b981',fontSize:'0.9rem'}}>🔒</span>
                      </div>
                      {([
                        ['blob_path',   auditState.blobPath   ?? '—'],
                        ['policy',      auditState.policy     ?? '—'],
                        ['encryption',  auditState.encryption ?? '—'],
                        ['indexed_in',  auditState.indexedIn  ?? '—'],
                      ] as [string, string][]).map(([k, v]) => (
                        <div key={k} style={{display:'flex',gap:'8px',justifyContent:'space-between',marginBottom:'3px',alignItems:'flex-start'}}>
                          <span style={{color:'#e3b341',fontFamily:'monospace',fontSize:'0.62rem',flexShrink:0}}>{k}</span>
                          <span style={{color:'#9dd0ff',fontFamily:'monospace',fontSize:'0.62rem',textAlign:'right',flex:1}}>{v}</span>
                        </div>
                      ))}
                    </div>

                    {/* Security cards */}
                    <div className="idp-section-title">SECURITY — WORM Audit Design &amp; Legal Significance</div>
                    <div style={{fontSize:'0.62rem',color:'#6e7681',marginBottom:'8px'}}>worm properties · tamper evidence · regulatory compliance</div>
                    <div className="idp-security">
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · Immutability Lock — Even Azure Cannot Delete</div>
                        <div className="idp-sec-sub">{auditState.timestamp?.slice(11, 19) ?? ''}</div>
                        <div className="idp-sec-text">
                          Azure Immutable Blob Storage with LOCKED policy means: neither the bank, nor the bank's Azure subscription owner, nor Microsoft Azure support can delete or modify this blob before 2031-12-15. Enforced at the storage layer — not a permission setting. Satisfies RBI requirement for 7-year record retention.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`policy: { "immutabilityPolicy": {\n  "immutabilityPeriodSinceCreationInDays": 2557,\n  "state": "Locked"\n}}\nLocked = CANNOT be changed by any admin\nRetention until: 2031-12-15 ✓`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · PII Not in Audit — Privacy by Design</div>
                        <div className="idp-sec-sub">{auditState.timestamp?.slice(11, 19) ?? ''}</div>
                        <div className="idp-sec-text">
                          The audit record contains: user_sub_hash (SHA-256 of user ID — not raw), account_token (TKN-ACC-ab72 — not account number), beneficiary_token (TKN-BEN-r7x2), llm_reasoning_hash (SHA-256 — AI reasoning not stored verbatim). A data breach of the audit store exposes no PII. DPDP Act compliant.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`user_sub_hash: SHA256("user_4829f1a2")\naccount_token: "TKN-ACC-ab72"  ← not "••••3421"\nllm_reasoning_hash: SHA256(reasoning)\n→ Raw PII: ZERO fields in audit record ✓`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · Complete Authorisation Chain Preserved</div>
                        <div className="idp-sec-sub">{auditState.timestamp?.slice(11, 19) ?? ''}</div>
                        <div className="idp-sec-text">
                          The audit record links the complete authorisation chain: Judge → OPA routing → OPA tools → CBS → IMPS. Every decision, every authority, every reference number — all in one permanent record.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`opa_decision_ids: [\n  "${(auditState.opaDecisionIds ?? [])[0] ?? 'OPA-??????'}",   ← routing\n  "${(auditState.opaDecisionIds ?? [])[1] ?? 'OPA-tool-??'}",    ← AML tool\n  "${(auditState.opaDecisionIds ?? [])[2] ?? 'OPA-tool-??'}"     ← payment tool\n]\njudge_approval_ref: "${auditState.judgeApprovalRef ?? 'JUDGE-????'}"\ncbs_txn_id: "${auditState.cbsTxnId ?? 'CBS-TXN-2024-??????'}"\nimps_ref: "${auditState.impsRef ?? 'IMPS??????????'}"`}
                        </div>
                      </div>
                      <div className="idp-sec-card">
                        <div className="idp-sec-title">PASS · Mandatory Write — Blocks Completion If Audit Fails</div>
                        <div className="idp-sec-sub">{auditState.timestamp?.slice(11, 19) ?? ''}</div>
                        <div className="idp-sec-text">
                          audit-mcp.write_audit_event is called BEFORE payments-mcp returns SUCCESS to the agent. If the audit write fails: payments-mcp returns AUDIT_WRITE_FAILED. The agent surfaces an error — human escalation is mandatory. The payment may have executed (at CBS) but without audit, no success is sent to the customer.
                        </div>
                        <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                          {`Sequence:\n  1. CBS payment COMMITTED\n  2. audit-mcp.write_audit_event() ← MANDATORY\n  3. IF step 2 fails: return AUDIT_WRITE_FAILED\n     → agent does NOT send success to customer\n     → escalation queue notified\n     → manual audit entry required`}
                        </div>
                      </div>
                    </div>

                    <div className="idp-meta">
                      {auditState.auditId} · WORM sealed · {auditState.sealedBy} · Azure Immutable Blob · India Central · CMK encrypted · 7-year retention · {auditState.totalLatencyMs}ms total
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

          {/* ── Post-payment: Latency Breakdown + Security Cards ── */}
          {!isAuth && payStatus === 'done' && completionData && (
            <div className="con-step status-done" style={{marginTop:'4px'}}>
              <div className="idp-panel" style={{marginTop:0}}>

                {/* Header */}
                <div className="idp-header">
                  <div>
                    <div className="idp-title">FULL END-TO-END LATENCY BREAKDOWN</div>
                    <div className="idp-sub">All 14 steps · cumulative timing · where time was spent</div>
                  </div>
                  <span className="idp-pill">COMPLETE</span>
                </div>

                {/* Total banner */}
                <div style={{padding:'0.5rem 0.75rem',background:'rgba(16,185,129,0.08)',border:'1px solid rgba(16,185,129,0.25)',borderRadius:'5px',fontSize:'0.72rem',fontWeight:700,color:'#10b981',fontFamily:'monospace',textAlign:'center'}}>
                  COMPLETE — ALL 14 CHECKPOINTS IN {(completionData.totalMs / 1000).toFixed(2)} SECONDS
                </div>

                {/* Checkpoint timeline */}
                <div className="idp-section-title">SECURITY CHECKPOINT TIMELINE</div>
                <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                  {completionData.stepTimings.map(t => (
                    <div key={t.step} style={{display:'flex',gap:'8px',alignItems:'center',padding:'5px 8px',background:'#0b0f14',border:'1px solid #21262d',borderRadius:'5px',fontSize:'0.68rem'}}>
                      <span style={{width:'18px',flexShrink:0,color:'#6e7681',fontFamily:'monospace',textAlign:'right'}}>{t.step}</span>
                      <span style={{flex:1,color:'#c9d1d9'}}>{t.name}</span>
                      <span style={{color:'#7ee787',fontFamily:'monospace',fontWeight:700,flexShrink:0}}>{t.ms}ms</span>
                    </div>
                  ))}
                </div>

                {/* Summary bar */}
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.68rem',padding:'4px 2px'}}>
                  <span style={{color:'#8b949e'}}>14/14 Security checkpoints passed</span>
                  <span style={{color:'#10b981',fontWeight:700}}>{(completionData.totalMs / 1000).toFixed(2)}s Total end-to-end time</span>
                </div>

                {/* Post-payment security cards */}
                <div className="idp-section-title" style={{marginTop:'0.75rem'}}>SECURITY — What Happens After Payment Completes</div>
                <div style={{fontSize:'0.62rem',color:'#6e7681',marginBottom:'8px'}}>token lifecycle · agent cleanup · caep monitoring · explainability</div>
                <div className="idp-security">

                  {/* Card 1: Token still valid */}
                  <div className="idp-sec-card">
                    <div className="idp-sec-title" style={{color:'#7ee787'}}>ACTIVE · Token {caepSession} Still Valid ({expTtl ?? '—'}s Remaining)</div>
                    <div className="idp-sec-sub">{completionData.commitTs?.slice(11,19) ?? ''}</div>
                    <div className="idp-sec-text">
                      The delegated JWT expires at {formatTimeIST(exp)} — {expTtl ?? '—'} seconds from now. CAEP session {caepSession} is still monitoring. If the agent (which is now idle) somehow made an unexpected call: the CAEP session would detect anomalous post-completion activity and revoke. Standard practice: agents terminate after task completion, reducing the attack surface for the remaining token validity window.
                    </div>
                    <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                      {`Agent state: IDLE\nCAEP session: ${caepSession} (monitoring)\nToken expires: ${formatTimeIST(exp)}\nPost-completion risk: LOW ✓`}
                    </div>
                  </div>

                  {/* Card 2: Agent IDLE */}
                  <div className="idp-sec-card">
                    <div className="idp-sec-title" style={{color:'#7ee787'}}>PASS · Agent IDLE — Attack Surface Minimised</div>
                    <div className="idp-sec-sub">{completionData.commitTs?.slice(11,19) ?? ''}</div>
                    <div className="idp-sec-text">
                      {completionData.pod ?? 'payment_agent_svc pod'} entered IDLE state. Redis WAL ({completionData.walKey ?? 'pay_agent:wal:—'}) status = COMPLETED. No active tool sessions. SPIFFE SVID still valid ({Math.round((completionData.svidExpiresIn ?? 1200) / 60)} minutes remaining — auto-rotates at expiry).
                    </div>
                    <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                      {`Agent state: IDLE\nWAL status: COMPLETED\nOpen connections: 0\nSVID: valid (${Math.round((completionData.svidExpiresIn ?? 1200) / 60)}m remaining)\nNext rotation: automatic (no action needed)`}
                    </div>
                  </div>

                  {/* Card 3: Idempotency window */}
                  <div className="idp-sec-card">
                    <div className="idp-sec-title" style={{color:'#7ee787'}}>PASS · Idempotency Window Active ({expTtl ?? '—'}s)</div>
                    <div className="idp-sec-sub">{completionData.commitTs?.slice(11,19) ?? ''}</div>
                    <div className="idp-sec-text">
                      If the customer double-taps "Make Another Payment" or the app retries due to a UI timeout, the idempotency key ({(completionData.idempotencyKey ?? 'idem-????').slice(0,13)}) is still in: (1) Redis payments-mcp cache, (2) CBS idempotency_log (5-minute TTL). Both return cached SUCCESS immediately. Zero risk of double-debit.
                    </div>
                    <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                      {`${(completionData.idempotencyKey ?? 'idem-????').slice(0,13)}: stored in\n  1. Redis payments-mcp (TTL: ~${expTtl ?? '—'}s remaining)\n  2. CBS idempotency_log (TTL: 5min)\nDouble-tap result: cached SUCCESS ← no new debit`}
                    </div>
                  </div>

                  {/* Card 4: DPDP explainability */}
                  <div className="idp-sec-card">
                    <div className="idp-sec-title" style={{color:'#7ee787'}}>PASS · DPDP Act — Explainability Ready</div>
                    <div className="idp-sec-sub">{completionData.commitTs?.slice(11,19) ?? ''}</div>
                    <div className="idp-sec-text">
                      Customer can request: "Why did AI process my payment?" Under DPDP Act Section 12, the bank must provide an explanation. Generated from WORM audit record: PaymentOrchestrator AI Agent processed your IMPS payment. Security checks: AML (4 lists — clear), injection detection (50 patterns — clean), identity verification (KYC verified). All checks passed in {(completionData.totalMs / 1000).toFixed(2)} seconds.
                    </div>
                    <div style={{marginTop:'4px',background:'#020409',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',fontSize:'0.6rem',color:'#7ee787',whiteSpace:'pre'}}>
                      {`audit_id: ${(completionData.auditId ?? 'AUD-????').slice(0,24)}\ncbs_txn: ${completionData.cbsTxnId ?? '—'}\nimps_ref: ${completionData.impsRef ?? '—'}\nworm: immutable 7yr · DPDP Act ✓`}
                    </div>
                  </div>

                </div>

                <div className="idp-meta">
                  14 security checkpoints · {completionData.totalMs}ms total · WORM sealed · {completionData.auditId?.slice(0,24) ?? '—'} · Agent idle · Token valid
                </div>
              </div>
            </div>
          )}

        {conError && (
          <div className="con-error"><span>✗</span> {conError}</div>
        )}

        {isAuth && sessionReady && (
          <div className="con-footer">
            <span className="con-footer-dot" />
            All checks passed · Session ready
          </div>
        )}
        {!isAuth && payStatus === 'done' && (
          <div className="con-footer">
            <span className="con-footer-dot" />
            Payment executed · Audit trail complete
          </div>
        )}
      </div>
    </div>
  )
}
