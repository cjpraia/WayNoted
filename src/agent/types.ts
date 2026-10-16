// Tipos compartilhados da camada de agentes no renderer (A1/A2, docs/SECURITY.md). O processo principal
// (electron/agent-access.cjs) é a fonte da verdade; aqui só o formato dos dados que chegam por IPC.
export type AgentScope = 'read' | 'write' | 'clip'
export interface AgentClientView { id: string; name: string; scopes: AgentScope[]; autoWrite: boolean; createdAt: number; lastUsedAt: number | null; legacy: boolean; grantedUntil: number | null; kind?: 'clipper' }
export interface AgentDiffOp { t: 'same' | 'add' | 'del' | 'gap'; text?: string; count?: number }
export interface AgentDiff { added: number; removed: number; ops: AgentDiffOp[]; truncated: boolean }
export interface AgentChange { kind: string; pageId?: string; title?: string; parentTitle?: string; diff: AgentDiff }
export interface AgentApproval { id: string; clientId: string; clientName: string; createdAt: number; expiresAt: number; timeoutSec: number; change: AgentChange }
export interface AgentSettingsView { timeoutSec: number; minTimeoutSec: number; maxTimeoutSec: number; legacyNotice: boolean }
export interface AgentCliStatus { available: boolean; path?: string; state?: 'missing' | 'linked' | 'stale' | 'file' }
export interface AgentOverview { apiEnabled: boolean; url: string | null; clients: AgentClientView[]; settings: AgentSettingsView; pending: AgentApproval[]; pairing?: { code: string; expiresAt: number } | null; cli: AgentCliStatus }
export interface AgentSnippets { json: string; claudeCode: string }
export type AgentLogResult = 'ok' | 'auto' | 'granted' | 'approved' | 'rejected' | 'timeout' | 'denied' | 'error'
export interface AgentLogEntry { id: string; at: number; clientId: string | null; client: string; method: string; action: string; target: string; result: AgentLogResult; status: number; detail?: string }
export type AgentEvent = { type: 'pending'; approval: AgentApproval } | { type: 'resolved'; id: string; outcome: unknown }
