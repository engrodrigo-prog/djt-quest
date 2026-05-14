import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type React from "react";
import { LibraryBig, MessageCircle, Plus } from "lucide-react";

import { useI18n } from "@/contexts/I18nContext";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { ForumKbThemeMenu } from "@/components/ForumKbThemeMenu";
import type { ForumKbSelection } from "@/components/ForumKbThemeSelector";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type ChatMessageMeta = {
  truncated?: boolean;
  incomplete_reason?: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
  meta?: ChatMessageMeta;
};

export type ChatQuality = "auto" | "instant" | "thinking";

export interface ChatSourceRef {
  id: string;
  title?: string;
}

const isImageUrl = (url: string) =>
  /\.(png|jpe?g|webp|gif|bmp|tif|tiff|heic|heif|avif)(\?|#|$)/i.test(url || "");

const getAttachmentLabel = (url: string) => {
  if (!url) return "Anexo";
  try {
    const clean = url.split("?")[0].split("#")[0];
    return decodeURIComponent(clean.split("/").pop() || "Anexo") || "Anexo";
  } catch {
    return url.split("/").pop() || "Anexo";
  }
};

export interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  uploading: boolean;
  error: string | null;

  viewportRef: React.RefObject<HTMLDivElement>;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  onInputChange: (val: string) => void;
  onInputFocus: () => void;
  onInputBlur: () => void;

  oracleMode: boolean;
  activeSources: ChatSourceRef[];
  selectedSourceTitle: string | null;

  quality: ChatQuality;
  onQualityChange: (q: ChatQuality) => void;
  useWeb: boolean;
  onUseWebChange: (v: boolean) => void;
  kbEnabled: boolean;
  onKbEnabledChange: (v: boolean) => void;
  kbSelection: ForumKbSelection;
  onKbSelectionChange: (sel: ForumKbSelection) => void;

  attachments: string[];
  onAttachmentsChange: (atts: string[]) => void;
  attachmentsOpen: boolean;
  onAttachmentsOpenChange: (open: boolean) => void;
  uploadKey: number;
  onUploadingChange: (v: boolean) => void;
  onResetAttachments: () => void;

  inputFocused?: boolean;

  onSend: () => void;
  onContinueFromTruncated: (idx: number) => void;
  onNewChat: () => void;
  onStop: () => void;
  onOpenCatalog: () => void;
  onOpenUpload: () => void;
  onClearSource: () => void;
}

export function ChatPanel({
  messages,
  loading,
  uploading,
  error,
  viewportRef,
  inputRef,
  input,
  onInputChange,
  onInputFocus,
  onInputBlur,
  oracleMode,
  activeSources,
  selectedSourceTitle,
  quality,
  onQualityChange,
  useWeb,
  onUseWebChange,
  kbEnabled,
  onKbEnabledChange,
  kbSelection,
  onKbSelectionChange,
  attachments,
  onAttachmentsChange,
  attachmentsOpen,
  onAttachmentsOpenChange,
  uploadKey,
  onUploadingChange,
  onResetAttachments,
  inputFocused,
  onSend,
  onContinueFromTruncated,
  onNewChat,
  onStop,
  onOpenCatalog,
  onOpenUpload,
  onClearSource,
}: ChatPanelProps) {
  const { t } = useI18n();

  return (
    <Card className="-mx-3 rounded-none sm:mx-0 sm:rounded-lg">
      <CardHeader className="space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Chat
            </CardTitle>
            <CardDescription>
              {activeSources.length > 0
                ? `${activeSources.length} fonte${activeSources.length > 1 ? "s" : ""} selecionada${activeSources.length > 1 ? "s" : ""}`
                : "Catálogo geral — selecione fontes no painel para focar."}
            </CardDescription>
          </div>
        </div>

        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible sm:pb-0">
          <div className="flex shrink-0 items-center gap-1 rounded-full border p-1">
            <span className="pl-2 pr-1 text-[11px] font-medium text-muted-foreground">
              {t("studylab.gptModelLabel")}
            </span>
            <Button
              type="button"
              size="sm"
              variant={quality === "auto" ? "default" : "ghost"}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => onQualityChange("auto")}
              disabled={loading}
            >
              {t("studylab.gptModelAuto")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={quality === "instant" ? "default" : "ghost"}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => onQualityChange("instant")}
              disabled={loading}
              title={t("studylab.gptModelAutoFastHint")}
            >
              {t("studylab.gptModelAutoFast")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={quality === "thinking" ? "default" : "ghost"}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => onQualityChange("thinking")}
              disabled={loading}
              title={t("studylab.gptModelExtendedHint")}
            >
              {t("studylab.gptModelExtended")}
            </Button>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5">
            <Switch
              id="studylab-web-toggle"
              checked={useWeb}
              onCheckedChange={onUseWebChange}
              disabled={loading}
            />
            <Label htmlFor="studylab-web-toggle" className="text-xs font-medium">
              Pesquisa web
            </Label>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5">
            <Switch id="studylab-kb-toggle" checked={kbEnabled} onCheckedChange={onKbEnabledChange} />
            <Label htmlFor="studylab-kb-toggle" className="text-xs font-medium">
              {t("studylab.hashtagFocus")}
            </Label>
          </div>
          {!oracleMode && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={onOpenCatalog}
              >
                Escolher material
              </Button>
              {selectedSourceTitle && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={onClearSource}
                >
                  Limpar material
                </Button>
              )}
            </>
          )}
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onNewChat}>
            Nova conversa
          </Button>
          {loading && (
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onStop}>
              Parar
            </Button>
          )}
        </div>

        {kbEnabled && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              {t("studylab.hashtagFocusHint")}
            </p>
            <ForumKbThemeMenu selected={kbSelection} onSelect={onKbSelectionChange} />
          </div>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 p-3 pt-0 sm:p-6 sm:pt-0">
        <div
          ref={viewportRef}
          className={`overflow-y-auto rounded-md border bg-muted/30 p-2 sm:p-3 ${
            inputFocused
              ? "min-h-[20vh] [@media(orientation:landscape)]:min-h-[15vh]"
              : "min-h-[42vh] [@media(orientation:landscape)]:min-h-[32vh]"
          } sm:min-h-[55vh]`}
        >
          {messages.length === 0 && (
            <div className="flex h-full min-h-[30vh] flex-col items-center justify-center gap-4 py-8 text-center">
              {oracleMode ? (
                <p className="text-sm text-muted-foreground max-w-sm">
                  Pergunte qualquer coisa. O Catálogo busca em todos os seus materiais{useWeb ? " e na web" : ""}.
                </p>
              ) : selectedSourceTitle ? (
                <>
                  <p className="text-xs text-muted-foreground">Material selecionado:</p>
                  <p className="text-sm font-medium max-w-xs truncate">{selectedSourceTitle}</p>
                  <p className="text-xs text-muted-foreground">Digite sua pergunta abaixo para começar.</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Selecione um material para perguntar sobre ele, ou ative o modo Catálogo para buscar em toda a base.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onOpenCatalog}>
                      <LibraryBig className="mr-2 h-4 w-4" />
                      Abrir catálogo
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onOpenUpload}>
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar material
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {messages.map((m, idx) => (
            <div key={idx} className={`mb-2 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                    : "bg-background border",
                ].join(" ")}
              >
                {m.role === "assistant" ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-3 first:mt-0">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
                      ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                      li: ({ children }) => <li className="text-sm">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      code: ({ children, className }) => {
                        const isBlock = className?.includes("language-");
                        return isBlock ? (
                          <code className="block bg-muted rounded p-2 text-xs font-mono overflow-x-auto my-1.5 whitespace-pre">
                            {children}
                          </code>
                        ) : (
                          <code className="bg-muted rounded px-1 py-0.5 text-xs font-mono">{children}</code>
                        );
                      },
                      pre: ({ children }) => <pre className="my-1.5 overflow-x-auto">{children}</pre>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground my-2">
                          {children}
                        </blockquote>
                      ),
                      hr: () => <hr className="border-border my-2" />,
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noreferrer" className="underline text-primary">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                ) : (
                  m.content
                )}
                {m.role === "assistant" && m.meta?.truncated && (
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <span className="text-[11px] text-muted-foreground">Resposta truncada</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loading || uploading}
                      onClick={() => void onContinueFromTruncated(idx)}
                    >
                      Continuar
                    </Button>
                  </div>
                )}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.attachments.map((url, aIdx) =>
                      isImageUrl(url) ? (
                        <a key={`${url}-${aIdx}`} href={url} target="_blank" rel="noreferrer">
                          <img
                            src={url}
                            alt={getAttachmentLabel(url)}
                            className="h-20 w-24 rounded-md border object-cover"
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <a
                          key={`${url}-${aIdx}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border bg-background/80 px-2 py-1 text-xs text-foreground"
                        >
                          {getAttachmentLabel(url)}
                        </a>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="mb-2 flex justify-start">
              <div className="flex items-center gap-1 rounded-2xl border bg-background px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>

        <div className="-mx-3 rounded-none border-x-0 border-t bg-background/60 px-3 py-2 sm:mx-0 sm:rounded-md sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
            placeholder={
              oracleMode
                ? "Digite sua pergunta…"
                : selectedSourceTitle
                  ? `Pergunte sobre: ${selectedSourceTitle}`
                  : "Selecione um material para perguntar"
            }
            rows={3}
            enterKeyHint="send"
            className="min-h-[120px] sm:min-h-[80px]"
            onKeyDown={(e) => {
              if ((e.nativeEvent as any)?.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />

          <div className="mt-2 flex items-center gap-2">
            <Dialog open={attachmentsOpen} onOpenChange={onAttachmentsOpenChange}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="relative h-11 w-11 shrink-0"
                  aria-label="Anexar arquivos"
                  title="Anexar arquivos"
                  disabled={loading}
                >
                  <Plus className="h-4 w-4" />
                  {uploading && (
                    <span
                      className="absolute -bottom-1 -right-1 inline-flex h-3 w-3 rounded-full bg-amber-400"
                      aria-label="Enviando anexos"
                      title="Enviando…"
                    />
                  )}
                  {attachments.length > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-5 min-w-[20px] justify-center px-1 text-[10px]">
                      {attachments.length}
                    </Badge>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Anexos</DialogTitle>
                  <DialogDescription>
                    Imagens, desenhos, PDFs e documentos ajudam o Catálogo a aprofundar a resposta. O StudyLab mantém um histórico de uso para consultas futuras.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <AttachmentUploader
                    key={uploadKey}
                    onAttachmentsChange={onAttachmentsChange}
                    onUploadingChange={onUploadingChange}
                    maxFiles={4}
                    maxSizeMB={20}
                    bucket="evidence"
                    pathPrefix="study-chat"
                    capture="environment"
                    acceptMimeTypes={[
                      "application/pdf",
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                      "application/vnd.ms-excel",
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      "text/plain",
                      "application/json",
                      "text/csv",
                      "image/heic",
                      "image/heif",
                      "image/jpeg",
                      "image/png",
                      "image/avif",
                      "image/webp",
                    ]}
                    maxVideoSeconds={0}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {uploading
                        ? "Enviando…"
                        : attachments.length
                          ? `${attachments.length} anexo(s) selecionado(s).`
                          : "Nenhum anexo selecionado."}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onResetAttachments}
                      disabled={!attachments.length && !uploading}
                    >
                      Limpar
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <VoiceRecorderButton
              size="sm"
              label="Falar"
              className="shrink-0 [&_span]:hidden sm:[&_span]:inline"
              onText={(text) => onInputChange([input, text].filter(Boolean).join("\n\n"))}
            />

            <Button
              type="button"
              className="h-11 flex-1 sm:flex-none"
              onClick={onSend}
              disabled={loading || uploading || (!input.trim() && attachments.length === 0)}
            >
              {loading ? "Pensando..." : "Enviar"}
            </Button>
          </div>

          <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">Enter envia • Shift+Enter quebra linha</p>
        </div>
        {error && <p className="text-sm text-destructive">Erro: {error}</p>}
      </CardContent>
    </Card>
  );
}
