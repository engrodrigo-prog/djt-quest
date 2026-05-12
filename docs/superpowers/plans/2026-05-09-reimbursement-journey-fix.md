# Reimbursement Journey Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 500 errors on the reimbursement API and improve UX of the user form and ADM panel.

**Architecture:** Fix wrong import paths in 3 server handlers (root cause of all 500s), then add targeted UX improvements to `FinanceRequests.tsx` and `FinanceRequestsManagement.tsx` — no new routes, no new tables, no new dependencies.

**Tech Stack:** TypeScript, React, Vite, Supabase, shadcn/ui, lucide-react, Vercel serverless functions

---

## Files Modified

- `server/api-handlers/finance-request.ts` — fix 4 import paths
- `server/api-handlers/finance-requests.ts` — fix 4 import paths
- `server/api-handlers/finance-requests-admin.ts` — fix 4 import paths
- `src/pages/FinanceRequests.tsx` — UX: spinner, success banner, attachment preview, BRL validation, inline error
- `src/components/FinanceRequestsManagement.tsx` — UX: metrics row, rejection confirmation, history timeline, requester highlight

---

## Task 1: Fix import paths in 3 server handlers

**Files:**
- Modify: `server/api-handlers/finance-request.ts:3-6`
- Modify: `server/api-handlers/finance-requests.ts:3-6`
- Modify: `server/api-handlers/finance-requests-admin.ts:3-6`

All three files import from `'../server/env-guard.js'` and `'../server/finance/*.js'`. The correct paths (matching every other handler) are `'../env-guard.js'` and `'../finance/*.js'`.

- [ ] **Step 1: Fix `finance-request.ts` imports**

Replace lines 3-6 in `server/api-handlers/finance-request.ts`:

```typescript
import { assertDjtQuestServerEnv } from '../env-guard.js';
import { financeRequestCancelSchema } from '../finance/schema.js';
import { canManageFinanceRequests, isGuestProfile } from '../finance/permissions.js';
import { pickQueryParam } from '../finance/utils.js';
```

- [ ] **Step 2: Fix `finance-requests.ts` imports**

Replace lines 3-6 in `server/api-handlers/finance-requests.ts`:

```typescript
import { assertDjtQuestServerEnv } from '../env-guard.js';
import { financeRequestCreateSchema } from '../finance/schema.js';
import { isGuestProfile } from '../finance/permissions.js';
import { clampLimit, parseBrlToCents, pickQueryParam, safeText, tryParseStorageFromPublicUrl } from '../finance/utils.js';
```

- [ ] **Step 3: Fix `finance-requests-admin.ts` imports**

Replace the first 4 imports in `server/api-handlers/finance-requests-admin.ts` (same `../server/` prefix issue):

```typescript
import { assertDjtQuestServerEnv } from '../env-guard.js';
import { financeRequestAdminUpdateSchema } from '../finance/schema.js';
import { canManageFinanceRequests, isGuestProfile } from '../finance/permissions.js';
import { clampLimit, pickQueryParam, safeText } from '../finance/utils.js';
```

- [ ] **Step 4: Verify locally**

```bash
cd "/Users/rodrigonascimento/Desktop/Enerlytics/DJT Quest/djt-quest"
npm run typecheck 2>&1 | grep -i "finance"
```

Expected: no errors on finance files. Any remaining errors are pre-existing and unrelated.

- [ ] **Step 5: Commit**

```bash
git add server/api-handlers/finance-request.ts server/api-handlers/finance-requests.ts server/api-handlers/finance-requests-admin.ts
git commit -m "fix(finance): corrigir imports errados nos handlers de reembolso

Três handlers importavam de '../server/env-guard.js' e '../server/finance/*.js'
(caminho inexistente: server/api-handlers/../server/ = server/server/).
Correto: '../env-guard.js' e '../finance/*.js', igual a todos os outros handlers.
Causa raiz de todos os 500 na jornada de reembolso."
```

---

## Task 2: Form UX — Attachment preview list

**Files:**
- Modify: `src/pages/FinanceRequests.tsx:723-747`

Currently there's only a counter `{attachmentItems.length} arquivo(s)`. Add a visible list below `AttachmentUploader` showing filename and size.

- [ ] **Step 1: Add `formatBytes` helper near top of file (after `formatBrl`)**

Add after line 102 in `src/pages/FinanceRequests.tsx`:

```typescript
const formatBytes = (bytes: number | undefined) => {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
```

- [ ] **Step 2: Replace attachment section JSX**

In `src/pages/FinanceRequests.tsx`, find the attachment section (lines 723-747) and replace it:

```tsx
{form.requestKind === "Reembolso" ? (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <Label>Anexos (PDF/JPG/PNG)</Label>
      <span className="text-[11px] text-muted-foreground">{attachmentItems.length}/8</span>
    </div>
    <AttachmentUploader
      onAttachmentsChange={() => {}}
      onAttachmentItemsChange={(items) => setAttachmentItems(items as any)}
      onUploadingChange={setAttachmentsUploading}
      maxFiles={8}
      maxImages={8}
      maxVideos={0}
      maxSizeMB={25}
      capture="environment"
      includeImageGpsMeta
      bucket="evidence"
      pathPrefix="finance-requests"
      acceptMimeTypes={["application/pdf", "image/jpeg", "image/png", "image/webp"]}
    />
    {attachmentItems.length > 0 && (
      <ul className="space-y-1 mt-1">
        {attachmentItems.map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
            <FileText className="h-3 w-3 flex-shrink-0" />
            <span className="truncate flex-1">{a.filename || `arquivo-${i + 1}`}</span>
            {a.sizeBytes ? <span className="flex-shrink-0">{formatBytes(a.sizeBytes)}</span> : null}
          </li>
        ))}
      </ul>
    )}
    <p className="text-[11px] text-muted-foreground">
      Para fotos, tentamos capturar GPS e horário (quando disponível no arquivo).
    </p>
  </div>
) : null}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/FinanceRequests.tsx
git commit -m "feat(finance): preview de anexos com nome e tamanho no formulário"
```

---

## Task 3: Form UX — Spinner on submit button + inline error

**Files:**
- Modify: `src/pages/FinanceRequests.tsx:1,24,182,349-415,760-773`

- [ ] **Step 1: Add `Loader2` to lucide import**

In `src/pages/FinanceRequests.tsx` line 24, add `Loader2`:

```typescript
import { ArrowLeft, ChevronDown, FileText, Loader2, Plus, XCircle } from "lucide-react";
```

- [ ] **Step 2: Add `submitError` state**

After `const [submitting, setSubmitting] = useState(false);` (line 182), add:

```typescript
const [submitError, setSubmitError] = useState<string | null>(null);
```

- [ ] **Step 3: Clear error on open + set error on fail**

In `submitNew`, at the very start before the first `if (!canUse)` check, add:

```typescript
setSubmitError(null);
```

In the catch block (line 410-412), replace:

```typescript
} catch (e: any) {
  toast({ title: "Erro ao enviar", description: e?.message || "Tente novamente.", variant: "destructive" });
```

With:

```typescript
} catch (e: any) {
  const msg = e?.message || "Tente novamente.";
  setSubmitError(msg);
  toast({ title: "Erro ao enviar", description: msg, variant: "destructive" });
```

- [ ] **Step 4: Update submit button and add error message**

Replace the submit footer section (lines 760-773):

```tsx
<div className="px-6 py-4 border-t bg-background">
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div className="text-[11px] text-muted-foreground">
      {form.requestKind === "Reembolso"
        ? `Anexos: ${attachmentItems.length} arquivo(s)${attachmentsUploading ? " (enviando...)" : ""}`
        : form.requestKind === "Adiantamento"
        ? "Adiantamento: sem valor e sem anexo."
        : "Preencha os campos para habilitar o envio."}
    </div>
    <div className="flex flex-col items-end gap-1">
      {submitError && (
        <p className="text-[11px] text-destructive text-right">{submitError}</p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => { setNewOpen(false); setSubmitError(null); }}>
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={submitNew}
          disabled={submitting || attachmentsUploading || !canUse}
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando...</>
          ) : "Enviar"}
        </Button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/FinanceRequests.tsx
git commit -m "feat(finance): spinner no botão de envio e erro inline no formulário"
```

---

## Task 4: Form UX — Success banner with protocol

**Files:**
- Modify: `src/pages/FinanceRequests.tsx:171,385-409,440-465`

After a successful submission the dialog closes and the user sees only a toast (3s). Add a persistent green banner on the main list page.

- [ ] **Step 1: Add `lastSuccess` state**

After `const [items, setItems] = useState<RequestRow[]>([]);` (line 171):

```typescript
const [lastSuccess, setLastSuccess] = useState<{ protocol: string } | null>(null);
```

- [ ] **Step 2: Set `lastSuccess` on submit success**

In `submitNew`, after `toast({ title: "Solicitação enviada", ... })` (line 385), add:

```typescript
setLastSuccess({ protocol: json?.request?.protocol || "" });
```

- [ ] **Step 3: Add banner to main page JSX**

In the main return, after the `{!canUse ? ... }` block (around line 462), add:

```tsx
{lastSuccess && (
  <div className="flex items-start justify-between gap-3 rounded-md border border-emerald-600 bg-emerald-950/40 px-4 py-3">
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-emerald-400">Solicitação enviada com sucesso</p>
      <p className="text-[12px] text-muted-foreground mt-0.5">
        Protocolo: <span className="font-mono font-semibold text-emerald-300">{lastSuccess.protocol}</span>
      </p>
    </div>
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-[11px] text-muted-foreground flex-shrink-0"
      onClick={() => setLastSuccess(null)}
    >
      <XCircle className="h-4 w-4" />
    </Button>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/FinanceRequests.tsx
git commit -m "feat(finance): banner persistente com protocolo após envio de solicitação"
```

---

## Task 5: Form UX — BRL inline validation

**Files:**
- Modify: `src/pages/FinanceRequests.tsx:182,710-716`

- [ ] **Step 1: Add `brlError` state**

After `const [submitError, setSubmitError] = useState<string | null>(null);`:

```typescript
const [brlError, setBrlError] = useState<string | null>(null);
```

- [ ] **Step 2: Add `validateBrl` helper**

Add after the `formatBytes` helper:

```typescript
const validateBrl = (raw: string): string | null => {
  if (!raw.trim()) return null;
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  if (isNaN(n) || n <= 0) return "Valor inválido. Use formato como 123,45 ou 1.234,56";
  return null;
};
```

- [ ] **Step 3: Update amount input with onBlur + error**

Replace the amount input section (lines 711-716):

```tsx
{form.requestKind === "Reembolso" ? (
  <div>
    <Label>Valor (R$)</Label>
    <Input
      className={`mt-1 ${brlError ? "border-destructive" : ""}`}
      placeholder="Ex: 123,45"
      value={form.amountBrl}
      onChange={(e) => { setForm((p) => ({ ...p, amountBrl: e.target.value })); setBrlError(null); }}
      onBlur={(e) => setBrlError(validateBrl(e.target.value))}
    />
    {brlError && <p className="text-[11px] text-destructive mt-1">{brlError}</p>}
  </div>
) : null}
```

- [ ] **Step 4: Clear `brlError` in `resetForm`**

In `resetForm()` (line 297), add `setBrlError(null);` after `setAttachmentsUploading(false);`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FinanceRequests.tsx
git commit -m "feat(finance): validação inline do valor BRL no formulário de reembolso"
```

---

## Task 6: ADM Panel — Metrics row

**Files:**
- Modify: `src/components/FinanceRequestsManagement.tsx:217-225,227-233`

The existing `totals` useMemo at line 217 calculates `pending/approved/total` but isn't displayed. Replace with a richer `metrics` object and add a stats row.

- [ ] **Step 1: Replace `totals` useMemo with `metrics`**

Replace lines 217-225 in `src/components/FinanceRequestsManagement.tsx`:

```typescript
const metrics = useMemo(() => ({
  total: items.length,
  enviado: items.filter((r) => normalizeFinanceStatusLabel(r.status) === "Enviado").length,
  emAnalise: items.filter((r) => normalizeFinanceStatusLabel(r.status) === "Em Análise").length,
  aprovado: items.filter((r) => ["Aprovado", "Pago"].includes(String(r.status))).length,
  reprovado: items.filter((r) => normalizeFinanceStatusLabel(r.status) === "Reprovado").length,
  totalBrl: items
    .map((r) => Number(r?.amount_cents))
    .filter((n) => Number.isFinite(n) && n > 0)
    .reduce((a, b) => a + b, 0),
}), [items]);
```

- [ ] **Step 2: Add metrics row in JSX after the CardHeader**

After `<CardContent className="space-y-3">` (line 233), add:

```tsx
{items.length > 0 && (
  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
    {[
      { label: "Total", value: metrics.total, className: "text-foreground" },
      { label: "Enviado", value: metrics.enviado, className: "text-blue-400" },
      { label: "Em Análise", value: metrics.emAnalise, className: "text-orange-400" },
      { label: "Aprovado", value: metrics.aprovado, className: "text-emerald-400" },
      { label: "Reprovado", value: metrics.reprovado, className: "text-red-400" },
    ].map(({ label, value, className }) => (
      <div key={label} className="rounded-md border bg-muted/20 px-3 py-2 text-center">
        <div className={`text-lg font-bold ${className}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/FinanceRequestsManagement.tsx
git commit -m "feat(finance): linha de métricas no painel ADM de reembolso"
```

---

## Task 7: ADM Panel — Rejection confirmation dialog

**Files:**
- Modify: `src/components/FinanceRequestsManagement.tsx:1,94-100,193-215`

Currently ADM can set "Reprovado" without confirmation or mandatory observation. Add a guard.

- [ ] **Step 1: Add `AlertDialog` imports**

In `src/components/FinanceRequestsManagement.tsx` line 6, add `AlertDialog` imports after `Dialog`:

```typescript
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
```

- [ ] **Step 2: Add `rejectConfirmOpen` state**

After `const [observation, setObservation] = useState<string>("");` (line 100):

```typescript
const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
```

- [ ] **Step 3: Guard `applyStatus` for Reprovado**

Replace `applyStatus` (lines 193-215):

```typescript
const applyStatus = async (skipConfirm = false) => {
  const id = String(detailId || "").trim();
  if (!id) return;
  if (nextStatus === "Reprovado" && !skipConfirm) {
    if (!observation.trim()) {
      toast({ title: "Observação obrigatória", description: "Informe o motivo da reprovação.", variant: "destructive" });
      return;
    }
    setRejectConfirmOpen(true);
    return;
  }
  try {
    setUpdating(true);
    const resp = await apiFetch("/api/finance-requests-admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: nextStatus, observation: observation || null }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error || "Falha ao atualizar status");
    toast({ title: "Status atualizado" });
    setDetailOpen(false);
    setDetailId(null);
    setDetail(null);
    void load();
  } catch (e: any) {
    toast({ title: "Erro", description: e?.message || "Falha ao atualizar", variant: "destructive" });
  } finally {
    setUpdating(false);
  }
};
```

- [ ] **Step 4: Add `AlertDialog` JSX at end of component return**

Before the final closing `</Card>` tag, add:

```tsx
<AlertDialog open={rejectConfirmOpen} onOpenChange={setRejectConfirmOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Confirmar reprovação?</AlertDialogTitle>
      <AlertDialogDescription>
        Esta ação vai reprovar a solicitação. Motivo informado: <strong>"{observation}"</strong>. O solicitante verá esta observação.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction
        className="bg-red-600 hover:bg-red-700"
        onClick={() => { setRejectConfirmOpen(false); void applyStatus(true); }}
      >
        Reprovar
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/FinanceRequestsManagement.tsx
git commit -m "feat(finance): confirmação obrigatória com motivo ao reprovar solicitação"
```

---

## Task 8: ADM Panel — Requester highlight + history timeline

**Files:**
- Modify: `src/components/FinanceRequestsManagement.tsx` (detail modal section)

- [ ] **Step 1: Find detail modal opening**

Locate the detail modal JSX — look for `<Dialog open={detailOpen}`. The modal contains `detail.request`, `detail.attachments`, `detail.history`.

- [ ] **Step 2: Add requester highlight block**

Inside the modal, after `<DialogHeader>...</DialogHeader>` and before the `{detailLoading ? ...}` block, find where `detail?.request` renders. At the very top of the content (before the `protocol` line), add a requester block:

```tsx
{detail?.request && (
  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
    <span className="font-semibold text-foreground">{detail.request.created_by_name || "—"}</span>
    {detail.request.created_by_matricula && (
      <span className="text-muted-foreground">Matrícula: <span className="font-mono">{detail.request.created_by_matricula}</span></span>
    )}
    {detail.request.created_by_email && (
      <span className="text-muted-foreground">{detail.request.created_by_email}</span>
    )}
  </div>
)}
```

- [ ] **Step 3: Enhance history section**

Find the history rendering section (look for `detail.history` map). Replace the current minimal history list with a timeline:

```tsx
<div className="rounded-md border p-2">
  <div className="text-[12px] font-medium mb-2">Histórico</div>
  {(detail.history || []).length ? (
    <ol className="relative border-l border-border/40 ml-2 space-y-3">
      {(detail.history || []).map((h: any) => {
        const b = financeStatusBadge(h.to_status);
        return (
          <li key={h.id} className="ml-4 text-[12px]">
            <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border border-border bg-background" />
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={b.variant} className={`text-[10px] px-1.5 py-0 ${b.className}`}>{b.label}</Badge>
              <span className="text-[11px] text-muted-foreground">
                {h.created_at ? new Date(h.created_at).toLocaleString(getActiveLocale()) : ""}
              </span>
            </div>
            {h.observation && (
              <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{h.observation}</p>
            )}
          </li>
        );
      })}
    </ol>
  ) : (
    <p className="text-[11px] text-muted-foreground">Sem histórico.</p>
  )}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/FinanceRequestsManagement.tsx
git commit -m "feat(finance): destaque do solicitante e timeline de histórico no painel ADM"
```

---

## Task 9: Final typecheck + deploy

- [ ] **Step 1: Run typecheck**

```bash
cd "/Users/rodrigonascimento/Desktop/Enerlytics/DJT Quest/djt-quest"
npm run typecheck 2>&1 | tail -20
```

Expected: `Found 0 errors.` (or only pre-existing unrelated errors)

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: successful build, no new errors.

- [ ] **Step 3: Manual smoke test (local dev)**

```bash
npm run dev:vercel:nowarn
```

Test:
1. POST `/api/finance-requests` → expect 200 (not 500)
2. GET `/api/finance-requests` → expect `{ items: [...] }`
3. GET `/api/finance-request?id=<valid-id>` → expect request detail
4. GET `/api/finance-requests-admin` → expect admin list

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix(finance): ajustes finais pós-typecheck na jornada de reembolso"
```

- [ ] **Step 5: Deploy**

Push para main para trigger deploy no Vercel:

```bash
git push origin main
```

---

## Success Criteria

- [ ] POST `/api/finance-requests` retorna 200 com `{ success: true, request: { id, protocol, status } }`
- [ ] GET `/api/finance-requests` retorna lista do usuário (não 500)
- [ ] GET + PATCH `/api/finance-request` funcionam
- [ ] GET + PATCH `/api/finance-requests-admin` funcionam
- [ ] Upload de anexo mostra lista com nome e tamanho
- [ ] Botão "Enviar" mostra spinner durante POST
- [ ] Erro de submit aparece inline abaixo do botão
- [ ] Após envio com sucesso, banner verde mostra protocolo na página principal
- [ ] Campo valor BRL valida no onBlur e mostra erro inline
- [ ] Painel ADM mostra linha com 5 contadores (Total/Enviado/Em Análise/Aprovado/Reprovado)
- [ ] Reprovar exige observação e mostra dialog de confirmação
- [ ] Modal ADM mostra dados do solicitante (nome, matrícula, email)
- [ ] Histórico no modal ADM exibe timeline com badge de status e timestamp
