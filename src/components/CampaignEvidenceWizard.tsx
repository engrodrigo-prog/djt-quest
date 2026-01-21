import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { AttachmentViewer } from "@/components/AttachmentViewer";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";
import { useToast } from "@/hooks/use-toast";
import { ParticipantsSelector } from "@/components/ParticipantsSelector";
import { normalizeTeamId } from "@/lib/constants/points";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { localeToSpeechLanguage } from "@/lib/i18n/language";
import { apiFetch } from "@/lib/api";

type CampaignLite = {
  id: string;
  title: string;
  description?: string | null;
  narrative_tag?: string | null;
  is_active?: boolean | null;
  evidence_challenge_id?: string | null;
  is_team_campaign?: boolean | null;
};

type UploadedItem = { url: string; meta?: { exifGps?: { lat: number; lng: number } | null } };

type GpsPoint = { lat: number; lng: number; accuracy?: number | null; timestamp?: string | null; source: "exif" | "device" | "unavailable" };

const GUEST_TEAM_ID = "CONVIDADOS";

const isGuestProfile = (p: any) =>
  normalizeTeamId(p?.team_id) === GUEST_TEAM_ID ||
  normalizeTeamId(p?.sigla_area) === GUEST_TEAM_ID ||
  normalizeTeamId(p?.operational_base) === GUEST_TEAM_ID;

const normalizeHashtag = (raw: string) =>
  String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

const buildDraftKey = (campaignId: string, userId: string) => `campaign_evidence_draft:${campaignId}:${userId}`;

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
]);

const isImageAttachment = (url: string) => {
  const ext = String(url || "").split(".").pop()?.toLowerCase();
  return Boolean(ext && IMAGE_EXTENSIONS.has(ext));
};

export function CampaignEvidenceWizard({
  open,
  onOpenChange,
  campaign,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: CampaignLite;
  onSubmitted?: (meta?: { eventId?: string | null; sepbookPostId?: string | null }) => void;
}) {
  const { user, profile } = useAuth() as any;
  const { toast } = useToast();

  const currentUserId = String(user?.id || "");
  const isGuest = useMemo(() => isGuestProfile(profile), [profile]);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [participants, setParticipants] = useState<string[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const imageUrls = useMemo(() => attachmentUrls.filter((url) => isImageAttachment(url)), [attachmentUrls]);
  const documentUrls = useMemo(() => attachmentUrls.filter((url) => !isImageAttachment(url)), [attachmentUrls]);
  const [imageItems, setImageItems] = useState<UploadedItem[]>([]);
  const [imagesUploading, setImagesUploading] = useState(false);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioTranscript, setAudioTranscript] = useState<string>("");
  const [audioTranscribing, setAudioTranscribing] = useState(false);

  const [text, setText] = useState<string>("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPeople, setMentionPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [suggestedHashtags, setSuggestedHashtags] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  const [sapNote, setSapNote] = useState<string>("");
  const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lng: number; accuracy?: number | null; timestamp?: string | null } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [publishPromptOpen, setPublishPromptOpen] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishPayload, setPublishPayload] = useState<{
    eventId: string;
    attachments: string[];
    content: string;
    participantIds: string[];
    gpsItems: any[];
    locationLabel: string | null;
    locationLat: number | null;
    locationLng: number | null;
    tags: string[];
    transcript: string | null;
    sapNote: string | null;
  } | null>(null);

  // init participants + draft restore when opening
  useEffect(() => {
    if (!open) return;
    if (!campaign?.id || !currentUserId) return;

    const fallbackSelected = [currentUserId];
    const key = buildDraftKey(campaign.id, currentUserId);
    let restored = false;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === "object") {
          setStep((d.step as any) || 1);
          setParticipants(Array.isArray(d.participants) ? d.participants : fallbackSelected);
          setAttachmentUrls(Array.isArray(d.attachmentUrls) ? d.attachmentUrls : []);
          setImageItems(Array.isArray(d.imageItems) ? d.imageItems : []);
          setText(typeof d.text === "string" ? d.text : "");
          setSapNote(typeof d.sapNote === "string" ? d.sapNote : "");
          setTags(Array.isArray(d.tags) ? d.tags : []);
          restored = true;
        }
      }
    } catch {
      /* ignore */
    }
    if (!restored) {
      setStep(1);
      setParticipants(fallbackSelected);
      setAttachmentUrls([]);
      setImageItems([]);
      setText("");
      setSapNote("");
      setTags([]);
      setSuggestedHashtags([]);
      setDeviceLocation(null);
      setGpsEnabled(false);
    }
  }, [campaign?.id, currentUserId, open]);

  // persist draft while open
  useEffect(() => {
    if (!open) return;
    if (!campaign?.id || !currentUserId) return;
    const key = buildDraftKey(campaign.id, currentUserId);
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          step,
          participants,
          attachmentUrls,
          imageItems,
          text,
          sapNote,
          tags,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [campaign?.id, currentUserId, imageItems, attachmentUrls, open, participants, sapNote, step, tags, text]);

  // audio preview URL
  useEffect(() => {
    if (!audioFile) {
      setAudioPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioPreviewUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    };
  }, [audioFile]);

  const selectedParticipantsValue = useMemo(() => {
    const base = new Set<string>((participants || []).filter(Boolean));
    base.add(currentUserId);
    return { selectedIds: Array.from(base) };
  }, [currentUserId, participants]);

  const mentionIds = useMemo(() => {
    const ids = new Set<string>((selectedParticipantsValue.selectedIds || []).map(String));
    ids.delete(currentUserId);
    return Array.from(ids).filter(Boolean).sort();
  }, [currentUserId, selectedParticipantsValue.selectedIds]);

  const mentionIdsKey = useMemo(() => mentionIds.join(","), [mentionIds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mentionIds.length) {
        setMentionPeople([]);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id,name")
          .in("id", mentionIds)
          .order("name", { ascending: true })
          .limit(200);
        if (error) throw error;
        const next = (Array.isArray(data) ? data : [])
          .map((p: any) => ({ id: String(p.id), name: String(p.name || "").trim() }))
          .filter((p: any) => p.id && p.name);
        if (!cancelled) setMentionPeople(next);
      } catch {
        if (!cancelled) setMentionPeople([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mentionIds, mentionIdsKey]);

  const updateMentionQuery = (nextText: string) => {
    const re = /@([A-Za-z0-9_.-]{0,30})$/;
    const match = String(nextText || "").slice(-40).match(re);
    setMentionQuery(match ? String(match[1] || "") : null);
  };

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return mentionPeople.slice(0, 10);
    return mentionPeople.filter((p) => String(p.name || "").toLowerCase().includes(q)).slice(0, 10);
  }, [mentionPeople, mentionQuery]);

  const insertMention = (name: string) => {
    const token = normalizeHashtag(name).replace(/^_+|_+$/g, "");
    setText((prev) => {
      const re = /@([A-Za-z0-9_.-]{0,30})$/;
      const m = String(prev || "").slice(-40).match(re);
      if (!m) return [prev.trim(), `@${token}`].filter(Boolean).join(" ");
      // Replace the last "@..." at the end.
      return String(prev || "").replace(re, `@${token}`);
    });
    setMentionQuery(null);
  };

  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));
  const addTag = (raw: string) => {
    const t = normalizeHashtag(raw);
    if (!t) return;
    setTags((prev) => Array.from(new Set([...prev, t])).slice(0, 10));
  };

  const fetchHashtags = async () => {
    const body = [
      `Campanha: ${campaign.title}`,
      campaign.description ? `Objetivo: ${campaign.description}` : "",
      audioTranscript ? `Transcrição: ${audioTranscript}` : "",
      text ? `Texto: ${text}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (body.trim().length < 5) return;
    setTagsLoading(true);
    try {
      const resp = await apiFetch("/api/ai?handler=suggest-hashtags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const json = await resp.json().catch(() => ({}));
      const items = Array.isArray(json?.hashtags) ? json.hashtags : [];
      setSuggestedHashtags(items.map((s: any) => String(s || "").trim()).filter(Boolean).slice(0, 5));
      if (json?.meta?.warning) {
        console.warn("suggest-hashtags warning:", json.meta.warning);
      }
    } catch (e: any) {
      toast({ title: "Falha ao sugerir hashtags", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setTagsLoading(false);
    }
  };

  const uploadAudioAndTranscribe = useCallback(
    async (file: File) => {
      if (!file) return;
      if (!currentUserId) return;
      setAudioUploading(true);
      setAudioTranscribing(true);
      try {
        // upload audio (optional attachment)
        const ext = (() => {
          const name = String(file.name || "");
          if (name.includes(".")) return name.split(".").pop() || "webm";
          const m = String(file.type || "").split(";")[0].trim().toLowerCase();
          if (m === "audio/mp4" || m === "audio/x-m4a") return "m4a";
          if (m === "audio/mpeg") return "mp3";
          if (m === "audio/wav") return "wav";
          if (m === "audio/ogg") return "ogg";
          if (m === "audio/webm") return "webm";
          return "webm";
        })();
        const path = `campaign-evidence-audio/${campaign.id}/${currentUserId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("evidence").upload(path, file, {
          upsert: false,
          cacheControl: "3600",
          contentType: file.type || undefined,
        } as any);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("evidence").getPublicUrl(path);
        const publicUrl = data?.publicUrl;
        if (!publicUrl) throw new Error("Falha ao obter URL do áudio");
        setAudioUrl(publicUrl);
        setAudioUploading(false);

        // transcribe
        const resp = await apiFetch("/api/ai?handler=transcribe-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl: publicUrl, mode: "organize", language: localeToSpeechLanguage(getActiveLocale()) }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha na transcrição");
        const transcript = String(json?.text || json?.transcript || "").trim();
        if (transcript) {
          setAudioTranscript(transcript);
        }
      } catch (e: any) {
        toast({ title: "Falha no áudio", description: e?.message || "Tente novamente", variant: "destructive" });
      } finally {
        setAudioUploading(false);
        setAudioTranscribing(false);
      }
    },
    [campaign.id, currentUserId, toast],
  );

  const requestDeviceLocation = useCallback(async () => {
    setGpsLoading(true);
    try {
      if (!navigator.geolocation) throw new Error("Geolocalização indisponível neste dispositivo.");
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10 * 60_000,
        });
      });
      const { latitude, longitude, accuracy } = pos.coords;
      const next = {
        lat: Number(latitude),
        lng: Number(longitude),
        accuracy: Number.isFinite(accuracy) ? Number(accuracy) : null,
        timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
      };
      setDeviceLocation(next);
    } catch (e: any) {
      setDeviceLocation(null);
      throw e;
    } finally {
      setGpsLoading(false);
    }
  }, []);

  // Auto-capture device GPS when needed (EXIF is preferred; device GPS is fallback).
  useEffect(() => {
    if (step !== 4) return;
    const needsDevice = imageItems.some((it) => {
      const g = it?.meta?.exifGps;
      return !(g && typeof g.lat === "number" && typeof g.lng === "number");
    });
    if (!needsDevice) return;
    if (deviceLocation || gpsLoading) return;
    void requestDeviceLocation().catch(() => {
      // Permission denied / unavailable: keep GPS as unavailable.
    });
  }, [deviceLocation, gpsLoading, imageItems, requestDeviceLocation, step]);

  const retryDeviceLocation = useCallback(async () => {
    try {
      await requestDeviceLocation();
    } catch (e: any) {
      toast({ title: "GPS indisponível", description: e?.message || "Permissão negada.", variant: "destructive" });
      setDeviceLocation(null);
    }
  }, [requestDeviceLocation, toast]);

  const gpsByUrl = useMemo(() => {
    const map = new Map<string, GpsPoint>();
    for (const item of imageItems) {
      const u = String(item?.url || "");
      if (!u) continue;
      const exif = item?.meta?.exifGps;
      if (exif && typeof exif.lat === "number" && typeof exif.lng === "number") {
        map.set(u, { lat: exif.lat, lng: exif.lng, source: "exif", timestamp: null, accuracy: null });
        continue;
      }
      if (deviceLocation) {
        map.set(u, {
          lat: deviceLocation.lat,
          lng: deviceLocation.lng,
          source: "device",
          accuracy: deviceLocation.accuracy ?? null,
          timestamp: deviceLocation.timestamp ?? null,
        });
        continue;
      }
      map.set(u, { lat: 0, lng: 0, source: "unavailable", accuracy: null, timestamp: null });
    }
    return map;
  }, [deviceLocation, imageItems]);

  const gpsSummary = useMemo(() => {
    const items = Array.from(gpsByUrl.values());
    const exif = items.filter((x) => x.source === "exif").length;
    const dev = items.filter((x) => x.source === "device").length;
    const none = items.filter((x) => x.source === "unavailable").length;
    return { exif, dev, none, total: items.length };
  }, [gpsByUrl]);

  const evidenceText = useMemo(() => String(text || "").trim(), [text]);
  const evidenceTextOk = useMemo(() => evidenceText.length >= 50, [evidenceText]);
  const audioTranscriptTextOk = useMemo(() => String(audioTranscript || "").trim().length >= 50, [audioTranscript]);
  const evidenceMediaOk = useMemo(() => attachmentUrls.length >= 1 || Boolean(audioUrl), [attachmentUrls.length, audioUrl]);
  const hasEvidence = useMemo(() => evidenceMediaOk || evidenceTextOk || audioTranscriptTextOk, [audioTranscriptTextOk, evidenceMediaOk, evidenceTextOk]);

  const canNextFromStep = (s: number) => {
    if (s === 1) return true;
    if (s === 2) return !imagesUploading && !audioUploading && !audioTranscribing;
    if (s === 3) return true;
    if (s === 4) return sapNote.trim().length <= 60;
    if (s === 5) return hasEvidence && !imagesUploading && !audioUploading && !audioTranscribing && !submitting;
    return true;
  };

  const combinedHashtags = useMemo(() => {
    const list = Array.from(new Set((tags || []).map((t) => normalizeHashtag(t)).filter(Boolean))).slice(0, 10);
    return list.map((t) => `#${t}`);
  }, [tags]);

  const contentForSepbook = useMemo(() => {
    const base = String(text || "").trim();
    const tail = combinedHashtags.join(" ");
    if (!tail) return base;
    if (!base) return tail;
    // Avoid duplicating if user already typed them.
    const already = combinedHashtags.filter((h) => base.includes(h));
    const missing = combinedHashtags.filter((h) => !already.includes(h));
    if (!missing.length) return base;
    return `${base}\n\n${missing.join(" ")}`.trim();
  }, [combinedHashtags, text]);

  const extractMentions = (value: string) =>
    Array.from(String(value || "").matchAll(/@([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/g)).map(
      (m) => String(m[1] || "").trim().toLowerCase(),
    );

  const pickMentionToken = (p: any) => {
    const handle = String(p?.mention_handle || "").trim();
    if (handle) return handle.replace(/^@+/, "");
    const email = String(p?.email || "").trim().toLowerCase();
    if (email) return email.replace(/^@+/, "");
    return "";
  };

  const buildMentionLine = (label: string, tokens: string[]) => {
    if (!tokens.length) return "";
    const unique = Array.from(new Set(tokens.filter(Boolean)));
    if (!unique.length) return "";
    return `${label}: ${unique.map((t) => `@${t}`).join(" ")}`;
  };

  const publishToSepbook = async () => {
    if (!publishPayload || !campaign?.id) return;
    setPublishLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      let leaders: any[] = [];
      let participants: any[] = [];
      try {
        const resp = await fetch(
          `/api/admin?handler=event-evaluators&event_id=${encodeURIComponent(publishPayload.eventId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const json = await resp.json().catch(() => ({}));
        if (resp.ok) {
          leaders = Array.isArray(json?.leaders) ? json.leaders : [];
          participants = Array.isArray(json?.participants) ? json.participants : [];
        }
      } catch {
        leaders = [];
        participants = [];
      }

      const baseText = String(publishPayload.content || "").trim();
      const existing = new Set(extractMentions(baseText));
      const leaderTokens = leaders
        .map((p) => pickMentionToken(p))
        .filter((t) => t && !existing.has(t.toLowerCase()))
        .filter((t) => /^([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)$/.test(t));
      const leaderSet = new Set(leaderTokens.map((t) => t.toLowerCase()));
      const participantTokens = participants
        .map((p) => pickMentionToken(p))
        .filter((t) => t && !existing.has(t.toLowerCase()) && !leaderSet.has(t.toLowerCase()))
        .filter((t) => /^([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)$/.test(t));

      const lines = [baseText].filter(Boolean);
      const leaderLine = buildMentionLine("Avaliadores", leaderTokens);
      const participantLine = buildMentionLine("Participantes", participantTokens);
      if (leaderLine) lines.push(leaderLine);
      if (participantLine) lines.push(participantLine);
      const finalText = lines.join("\n\n").trim();

      const resp = await fetch("/api/sepbook-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          content_md: finalText,
          attachments: publishPayload.attachments,
          campaign_id: campaign.id,
          challenge_id: campaign.evidence_challenge_id,
          participant_ids: publishPayload.participantIds,
          sap_service_note: publishPayload.sapNote,
          transcript: publishPayload.transcript,
          tags: publishPayload.tags,
          gps_meta: publishPayload.gpsItems,
          location_label: publishPayload.locationLabel,
          location_lat: publishPayload.locationLat,
          location_lng: publishPayload.locationLng,
          event_id: publishPayload.eventId,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao publicar no SEPBook");

      toast({ title: "Publicado", description: "Evidência publicada no SEPBook." });
      onSubmitted?.({ eventId: publishPayload.eventId, sepbookPostId: json?.post?.id || null });
      setPublishPromptOpen(false);
      setPublishPayload(null);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Falha ao publicar", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setPublishLoading(false);
    }
  };

  const submitEvidence = async () => {
    if (!currentUserId) return;
    if (!hasEvidence) {
      toast({
        title: "Envie uma evidência",
        description: "Adicione ao menos 1 anexo (foto/vídeo/arquivo) ou escreva um texto detalhado (mín. 50 caracteres).",
        variant: "destructive",
      });
      return;
    }
    if (audioTranscribing) {
      toast({ title: "Aguarde a transcrição do áudio", description: "A transcrição está em andamento.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const cleanSap = String(sapNote || "").trim();
      const parts = isGuest ? [currentUserId] : Array.from(new Set([currentUserId, ...(participants || [])]));

      // Remove guests from participants (unless the author is guest).
      let participantIds = parts;
      if (!isGuest) {
        try {
          const { data: rows } = await supabase
            .from("profiles")
            .select("id,team_id,sigla_area,operational_base")
            .in("id", participantIds.length ? participantIds : [currentUserId])
            .limit(2000);
          const allowed = (rows || []).filter((p: any) => !isGuestProfile(p)).map((p: any) => String(p.id));
          participantIds = allowed.includes(currentUserId) ? allowed : [currentUserId, ...allowed];
        } catch {
          // best-effort: keep as-is
        }
      }

      const gpsItems = imageItems.map((x) => {
        const u = String(x?.url || "");
        const g = gpsByUrl.get(u);
        if (!g) return { url: u, source: "unavailable" };
        if (g.source === "unavailable") return { url: u, source: "unavailable" };
        return {
          url: u,
          source: g.source,
          lat: g.lat,
          lng: g.lng,
          accuracy: g.accuracy ?? null,
          timestamp: g.timestamp ?? null,
        };
      });

      const gpsFirst = gpsItems.find((g: any) => g && g.source !== "unavailable" && typeof g.lat === "number" && typeof g.lng === "number") || null;
      const locationLabel = gpsFirst ? (gpsFirst.source === "exif" ? "GPS da foto" : "Local atual") : null;

      const attachments = [...attachmentUrls, ...(audioUrl ? [audioUrl] : [])];
      const resp = await apiFetch("/api/campaign-evidence-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaign.id,
          content_md: contentForSepbook,
          transcript: audioTranscript || null,
          tags,
          attachments,
          gps_meta: gpsItems,
          location_label: locationLabel,
          location_lat: gpsFirst ? gpsFirst.lat : null,
          location_lng: gpsFirst ? gpsFirst.lng : null,
          sap_service_note: cleanSap || null,
          participant_ids: participantIds.filter((id) => id !== currentUserId),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao registrar evidência");
      const eventId = String(json?.event_id || "");
      if (!eventId) throw new Error("Falha ao registrar evidência");

      toast({ title: "Evidência registrada", description: "Enviada para avaliação. Obrigado!" });
      onSubmitted?.({ eventId, sepbookPostId: null });
      setPublishPayload({
        eventId,
        attachments,
        content: contentForSepbook,
        participantIds: participantIds.filter((id) => id !== currentUserId),
        gpsItems,
        locationLabel,
        locationLat: gpsFirst ? gpsFirst.lat : null,
        locationLng: gpsFirst ? gpsFirst.lng : null,
        tags,
        transcript: audioTranscript || null,
        sapNote: cleanSap || null,
      });
      setPublishPromptOpen(true);

      // Clear draft (best-effort)
      try {
        localStorage.removeItem(buildDraftKey(campaign.id, currentUserId));
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      toast({ title: "Falha ao enviar evidência", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const titleByStep: Record<number, string> = {
    1: "1/5 Participantes",
    2: "2/5 Evidência",
    3: "3/5 Texto, @ e #",
    4: "4/5 Metadados (SAP e GPS)",
    5: "5/5 Revisão",
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate">{campaign.title}</span>
              <Badge variant="outline" className="text-[11px]">
                {titleByStep[step]}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Registrar evidência com fotos, vídeos, arquivos e/ou texto. {isGuest ? "Convidado não marca outros usuários." : "Marque quem participou."}
            </DialogDescription>
          </DialogHeader>

          {step === 1 && (
            <div className="space-y-3">
              {!isGuest && (
                <ParticipantsSelector
                  currentUserId={currentUserId}
                  currentTeamId={profile?.team_id}
                  isGuest={false}
                  value={selectedParticipantsValue}
                  onChange={(next) => setParticipants(next.selectedIds)}
                />
              )}
              {isGuest && (
                <div className="rounded-md border bg-white/5 p-3 text-sm text-muted-foreground">
                  <p>
                    Você está como <strong>Convidado</strong>: sua evidência será registrada apenas com você.
                  </p>
                  <p className="mt-2">
                    Se precisar evidenciar com outros participantes, peça para alguém da equipe DJTx registrar a evidência.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Anexos (opcional, máx. 5)</Label>
              <span className="text-xs text-muted-foreground">{Math.min(5, attachmentUrls.length)}/5</span>
            </div>
            <AttachmentUploader
              onAttachmentsChange={setAttachmentUrls}
              onAttachmentItemsChange={(items) =>
                setImageItems(
                  (items as UploadedItem[]).filter((item) => isImageAttachment(String(item?.url || ""))),
                )
              }
              maxFiles={5}
              maxImages={3}
              maxVideos={2}
              maxSizeMB={50}
              bucket="evidence"
              pathPrefix={`campaign-evidence/${campaign.id}`}
              acceptMimeTypes={[
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/gif",
                "image/heic",
                "image/heif",
                "image/avif",
                "video/mp4",
                "video/webm",
                "video/quicktime",
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/zip",
                "text/plain",
              ]}
              capture="environment"
              maxVideoSeconds={60}
              maxVideoDimension={1920}
              maxImageDimension={3840}
              imageQuality={0.82}
              onUploadingChange={setImagesUploading}
              includeImageGpsMeta
            />
            {attachmentUrls.length < 1 && !evidenceTextOk && !audioTranscriptTextOk && !audioUrl && (
              <p className="text-xs text-muted-foreground">
                Sem anexos ainda. Você pode continuar e registrar a evidência com texto e/ou áudio.
              </p>
            )}
            {documentUrls.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Documentos:{" "}
                {documentUrls.map((url) => {
                  const name = url.split("/").pop() || "arquivo";
                  return <span key={url}>{name}; </span>;
                })}
              </div>
            )}
          </div>

              <div className="space-y-2">
                <Label>Áudio (opcional)</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <VoiceRecorderButton
                      size="sm"
                      label="Gravar e transcrever"
                      onText={(t) => setAudioTranscript((prev) => (prev ? `${prev}\n\n${t}` : t))}
                      confirmBeforeInsert={false}
                    />
                    <Input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setAudioFile(f);
                        setAudioUrl(null);
                        if (f) uploadAudioAndTranscribe(f);
                      }}
                      className="sm:max-w-[360px]"
                    />
                    {audioFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAudioFile(null);
                          setAudioUrl(null);
                          setAudioTranscript("");
                        }}
                      >
                        Remover áudio
                      </Button>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {audioUploading ? "Enviando..." : audioTranscribing ? "Transcrevendo..." : audioTranscript ? "Transcrito" : "—"}
                  </div>
                </div>
                {audioPreviewUrl && <audio controls src={audioPreviewUrl} className="w-full" />}
                {audioTranscript && (
                  <div className="rounded-md border bg-white/5 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                    <div className="font-semibold text-foreground mb-1">Transcrição</div>
                    {audioTranscript}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Texto da evidência</Label>
                <Textarea
                  value={text}
                  onChange={(e) => {
                    const v = e.target.value;
                    setText(v);
                    updateMentionQuery(v);
                  }}
                  rows={6}
                  placeholder="Descreva a evidência (contexto, ação, resultado). Use @ para mencionar participantes."
                />
                {mentionSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {mentionSuggestions.map((p) => (
                      <button
                        key={`m-${p.id}`}
                        type="button"
                        onClick={() => insertMention(p.name)}
                        className="px-2 py-1 rounded-full border text-[11px] bg-background/60 hover:bg-muted"
                      >
                        @{normalizeHashtag(p.name)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>#Tags</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={fetchHashtags} disabled={tagsLoading}>
                      {tagsLoading ? "Gerando…" : "Sugerir # com IA"}
                    </Button>
                  </div>
                </div>

                {suggestedHashtags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {suggestedHashtags.map((h) => {
                      const norm = normalizeHashtag(h);
                      const active = tags.includes(norm);
                      return (
                        <button
                          key={`sug-${h}`}
                          type="button"
                          onClick={() => (active ? removeTag(norm) : addTag(norm))}
                          className={`px-2 py-1 rounded-full border text-[11px] ${
                            active ? "border-emerald-500/60 bg-emerald-500/10" : "border-muted-foreground/40 bg-background/60"
                          }`}
                        >
                          #{norm}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    placeholder="Adicionar tag manual…"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const v = (e.currentTarget as HTMLInputElement).value;
                      addTag(v);
                      (e.currentTarget as HTMLInputElement).value = "";
                    }}
                  />
                  <span className="text-[11px] text-muted-foreground">Enter para adicionar • até 10</span>
                </div>

                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t) => (
                      <span key={`tag-${t}`} className="inline-flex items-center gap-2 rounded-full border bg-white/5 px-2 py-1 text-[11px]">
                        #{t}
                        <button type="button" onClick={() => removeTag(t)} className="opacity-70 hover:opacity-100">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Nota SAP (opcional)</Label>
                <Input
                  value={sapNote}
                  onChange={(e) => setSapNote(e.target.value)}
                  placeholder="Ex.: 4001234567"
                />
                {sapNote.trim().length > 60 && (
                  <p className="text-xs text-destructive">Muito longo (máx. 60 caracteres).</p>
                )}
                <p className="text-[11px] text-muted-foreground">Campo opcional. Se vazio, não bloqueia o envio.</p>
              </div>

              <div className="rounded-md border bg-white/5 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Localização (GPS)</p>
                    <p className="text-[11px] text-muted-foreground">
                      Preferimos GPS do EXIF das fotos; se não existir, tentamos usar o GPS do dispositivo (permissão do navegador).
                    </p>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-2">
                  <span>EXIF: {gpsSummary.exif}/{gpsSummary.total}</span>
                  <span>Device: {gpsSummary.dev}/{gpsSummary.total}</span>
                  <span>Sem GPS: {gpsSummary.none}/{gpsSummary.total}</span>
                </div>

                {deviceLocation && (
                  <div className="text-[11px] text-muted-foreground">
                    Local atual capturado{deviceLocation.accuracy ? ` (±${Math.round(deviceLocation.accuracy)}m)` : ""}
                  </div>
                )}

                {gpsLoading && <div className="text-xs text-muted-foreground">Obtendo localização…</div>}
                {!deviceLocation && !gpsLoading && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      Se você negar a permissão do navegador, as fotos sem EXIF ficarão como “GPS indisponível”.
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => void retryDeviceLocation()} disabled={gpsLoading}>
                      Tentar novamente
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-md border bg-white/5 p-3 text-[11px] text-muted-foreground">
                Após enviar a evidência, vamos perguntar se você deseja publicar no SEPBook com marcação de líderes e participantes.
              </div>

              <div className="rounded-md border bg-white/5 p-3 space-y-3">
                <p className="text-sm font-semibold">Prévia</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{attachmentUrls.length} anexo(s)</span>
                  <span>•</span>
                  <span>{(isGuest ? 1 : Array.from(new Set([currentUserId, ...(participants || [])])).length)} participante(s)</span>
                  {tags.length > 0 && (
                    <>
                      <span>•</span>
                      <span>{tags.length} tag(s)</span>
                    </>
                  )}
                </div>
                {attachmentUrls.length > 0 && (
                  <AttachmentViewer
                    urls={attachmentUrls}
                    mediaLayout="grid"
                    showMetadata={false}
                    enableLightbox
                  />
                )}
                <div className="text-sm whitespace-pre-wrap">{contentForSepbook || <span className="text-muted-foreground">Sem texto.</span>}</div>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as any) : s))}
                disabled={step === 1 || submitting}
              >
                Voltar
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep((s) => (s < 5 ? ((s + 1) as any) : s))}
                disabled={step === 5 || !canNextFromStep(step) || submitting}
              >
                Próximo
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={submitEvidence} disabled={!canNextFromStep(5) || step !== 5 || submitting}>
                {submitting ? "Enviando..." : "Enviar evidência"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={publishPromptOpen}
        onOpenChange={(openNext) => {
          if (openNext) {
            setPublishPromptOpen(true);
            return;
          }
          setPublishPromptOpen(false);
          setPublishPayload(null);
          onOpenChange(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Publicar no SEPBook?</DialogTitle>
            <DialogDescription>
              Vamos publicar a evidência com o texto informado, marcando os líderes que vão avaliar e os participantes da ação.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-white/5 p-3 text-[11px] text-muted-foreground">
            {publishPayload ? (
              <>
                <div>{publishPayload.attachments.length} anexo(s)</div>
                <div>{publishPayload.participantIds.length} participante(s) marcado(s)</div>
                <div>{publishPayload.locationLabel ? `Local: ${publishPayload.locationLabel}` : "Sem localização"}</div>
              </>
            ) : (
              <div>Resumo indisponível.</div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPublishPromptOpen(false);
                setPublishPayload(null);
                onOpenChange(false);
              }}
              disabled={publishLoading}
            >
              Agora não
            </Button>
            <Button type="button" onClick={publishToSepbook} disabled={publishLoading}>
              {publishLoading ? "Publicando..." : "Publicar no SEPBook"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
