import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Upload, X, Image as ImageIcon, Music, Video, FileText, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "qt"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "webm", "m4a", "aac", "flac"]);

const getFileExt = (filename: string): string => {
  const name = String(filename || "").trim();
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).trim().toLowerCase();
};

const normalizeMime = (raw: string): string => {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "image/jpg") return "image/jpeg";
  if (t === "image/pjpeg") return "image/jpeg";
  if (t === "application/x-pdf") return "application/pdf";
  return t;
};

const guessMimeTypeFromFilename = (filename: string): string => {
  const ext = getFileExt(filename);
  if (!ext) return "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "avif") return "image/avif";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov" || ext === "qt") return "video/quicktime";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "m4a") return "audio/mp4";
  return "";
};

const isProbablyImageFile = (file: File): boolean => {
  const t = normalizeMime(String(file?.type || ""));
  if (t.startsWith("image/")) return true;
  const ext = getFileExt(String(file?.name || ""));
  return IMAGE_EXTS.has(ext);
};

const isProbablyVideoFile = (file: File): boolean => {
  const t = normalizeMime(String(file?.type || ""));
  if (t.startsWith("video/")) return true;
  const ext = getFileExt(String(file?.name || ""));
  return VIDEO_EXTS.has(ext);
};

const isProbablyAudioFile = (file: File): boolean => {
  const t = normalizeMime(String(file?.type || ""));
  if (t.startsWith("audio/")) return true;
  const ext = getFileExt(String(file?.name || ""));
  return AUDIO_EXTS.has(ext);
};

interface Attachment {
  id: string;
  file: File;
  filePath?: string;
  bucket?: string;
  preview?: string;
  uploading: boolean;
  uploaded: boolean;
  progress: number;
  url?: string;
  error?: string;
  meta?: {
    exifGps?: { lat: number; lng: number } | null;
    exifCapturedAt?: string | null;
  };
}

interface AttachmentUploaderProps {
  onAttachmentsChange: (urls: string[]) => void;
  /** Optional: emit URL+meta (e.g. EXIF GPS) for uploaded items */
  onAttachmentItemsChange?: (items: Array<{
    url: string;
    storageBucket?: string;
    storagePath?: string;
    filename?: string;
    contentType?: string;
    sizeBytes?: number;
    meta?: Attachment["meta"];
  }>) => void;
  maxFiles?: number;
  /** Optional: max number of image files (by MIME) */
  maxImages?: number;
  /** Optional: max number of video files (by MIME) */
  maxVideos?: number;
  maxSizeMB?: number;
  /** Optional list of MIME types to accept; defaults to internal ALLOWED_TYPES */
  acceptMimeTypes?: string[];
  /** Storage bucket to upload to. Defaults to 'forum-attachments' */
  bucket?: string;
  /** Optional path prefix inside the bucket (e.g., 'campaigns', 'challenges') */
  pathPrefix?: string;
  /** Enable a "Take photo" button on mobile: 'environment' (back), 'user' (front) or true */
  capture?: boolean | 'environment' | 'user';
  /** Opcional: limitar duração de vídeos (em segundos) */
  maxVideoSeconds?: number;
  /** Opcional: limitar maior dimensão do vídeo (px). Ex.: 1920 para 1080p. */
  maxVideoDimension?: number;
  /** Opcional: limitar maior dimensão de imagens (px). Default 1080. */
  maxImageDimension?: number;
  /** Qualidade JPEG de saída (0..1). Default 0.8. */
  imageQuality?: number;
  /** Callback opcional: avisa se há uploads em andamento */
  onUploadingChange?: (uploading: boolean) => void;
  /** When true, tries to extract EXIF GPS from images before any downscaling. */
  includeImageGpsMeta?: boolean;
}

const ALLOWED_TYPES = {
  'image/jpeg': { icon: ImageIcon, label: 'Imagem' },
  'image/png': { icon: ImageIcon, label: 'Imagem' },
  'image/gif': { icon: ImageIcon, label: 'Imagem' },
  'image/webp': { icon: ImageIcon, label: 'Imagem' },
  'image/avif': { icon: ImageIcon, label: 'Imagem' },
  'image/heic': { icon: ImageIcon, label: 'Imagem' },
  'image/heif': { icon: ImageIcon, label: 'Imagem' },
  'audio/mpeg': { icon: Music, label: 'Áudio' },
  'audio/wav': { icon: Music, label: 'Áudio' },
  'audio/webm': { icon: Music, label: 'Áudio' },
  'audio/ogg': { icon: Music, label: 'Áudio' },
  'audio/mp4': { icon: Music, label: 'Áudio' },
  'video/mp4': { icon: Video, label: 'Vídeo' },
  'video/webm': { icon: Video, label: 'Vídeo' },
  'video/quicktime': { icon: Video, label: 'Vídeo' },
  'application/pdf': { icon: FileText, label: 'PDF' },
};

export const AttachmentUploader = ({ 
  onAttachmentsChange,
  onAttachmentItemsChange,
  maxFiles = 10,
  maxImages,
  maxVideos,
  maxSizeMB = 50,
  acceptMimeTypes,
  bucket = 'forum-attachments',
  pathPrefix = '',
  capture,
  maxVideoSeconds,
  maxVideoDimension,
  maxImageDimension = 1080,
  imageQuality = 0.8,
  onUploadingChange,
  includeImageGpsMeta = false,
}: AttachmentUploaderProps) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const allowedMimeList = useMemo(
    () => (acceptMimeTypes && acceptMimeTypes.length > 0 ? acceptMimeTypes : Object.keys(ALLOWED_TYPES)),
    [acceptMimeTypes],
  );
  const allowedMimeSet = useMemo(
    () => new Set<string>(allowedMimeList.map((t) => normalizeMime(String(t || ""))).filter(Boolean)),
    [allowedMimeList],
  );
  const allowedWildcards = useMemo(
    () =>
      allowedMimeList
        .map((t) => normalizeMime(String(t || "")))
        .filter((t) => t.endsWith("/*"))
        .map((t) => t.slice(0, -1)),
    [allowedMimeList],
  );
  const inputId = useMemo(() => `file-upload-${Math.random().toString(36).slice(2)}`, []);
  const cameraInputId = useMemo(() => `camera-upload-${Math.random().toString(36).slice(2)}`, []);
  const cameraEnabled = Boolean(capture);
  const onAttachmentsChangeRef = useRef(onAttachmentsChange);
  const onAttachmentItemsChangeRef = useRef(onAttachmentItemsChange);
  const onUploadingChangeRef = useRef(onUploadingChange);
  const lastUrlsKeyRef = useRef<string>("");
  const lastItemsKeyRef = useRef<string>("");
  const lastUploadingRef = useRef<boolean | null>(null);

  useEffect(() => {
    onAttachmentsChangeRef.current = onAttachmentsChange;
  }, [onAttachmentsChange]);

  useEffect(() => {
    onAttachmentItemsChangeRef.current = onAttachmentItemsChange;
  }, [onAttachmentItemsChange]);

  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange;
  }, [onUploadingChange]);

  const cameraCaptureValue = useMemo(() => {
    if (!cameraEnabled) return undefined;
    if (typeof capture === 'string') return capture;
    return true;
  }, [cameraEnabled, capture]);

  const validateFile = useCallback((file: File): string | null => {
    const rawType = normalizeMime(String(file?.type || ""));
    const guessedType = guessMimeTypeFromFilename(String(file?.name || ""));
    const candidates = Array.from(new Set([rawType, guessedType].filter(Boolean)));

    const isAllowed = candidates.some((t) => {
      if (allowedMimeSet.has(t)) return true;
      return allowedWildcards.some((prefix) => t.startsWith(prefix));
    });

    if (!isAllowed) {
      const ext = getFileExt(String(file?.name || ""));
      const prettyType = rawType || (ext ? `.${ext}` : "desconhecido");
      return `Tipo de arquivo não permitido: ${prettyType}`;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `Arquivo muito grande: ${(file.size / 1024 / 1024).toFixed(1)}MB (máx: ${maxSizeMB}MB)`;
    }
    return null;
  }, [maxSizeMB, allowedMimeSet, allowedWildcards]);

  const ensureVideoDurationOk = useCallback(async (file: File): Promise<string | null> => {
    if ((!maxVideoSeconds && !maxVideoDimension) || !isProbablyVideoFile(file)) return null;
    if (typeof document === 'undefined') return null;
    return await new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          try {
            const dur = video.duration || 0;
            const w = Number(video.videoWidth || 0);
            const h = Number(video.videoHeight || 0);
            URL.revokeObjectURL(url);
            if (maxVideoSeconds && dur && dur > maxVideoSeconds + 0.5) {
              resolve(`Vídeo muito longo: ${Math.round(dur)}s (máx: ${maxVideoSeconds}s).`);
            } else if (maxVideoDimension && w && h && Math.max(w, h) > maxVideoDimension) {
              resolve(`Vídeo acima do recomendado: ${w}x${h} (máx: ${maxVideoDimension}px).`);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        };
        video.onerror = () => {
          URL.revokeObjectURL(url);
          resolve('Não foi possível ler os metadados do vídeo.');
        };
        video.src = url;
      } catch {
        resolve(null);
      }
    });
  }, [maxVideoDimension, maxVideoSeconds]);

  const createPreview = async (file: File): Promise<string | undefined> => {
    if (!isProbablyImageFile(file)) return undefined;

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    });
  };

  const clampLatLng = (lat: number, lng: number) => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    if (Math.abs(la) < 1e-9 && Math.abs(ln) < 1e-9) return null;
    return { lat: la, lng: ln };
  };

  const readFileAsArrayBuffer = async (file: File): Promise<ArrayBuffer | null> => {
    try {
      if (typeof (file as any)?.arrayBuffer === "function") {
        return await (file as any).arrayBuffer();
      }
    } catch {
      // fall back
    }
    if (typeof FileReader === "undefined") return null;
    return await new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
      } catch {
        resolve(null);
      }
    });
  };

  const extractGpsFromImage = async (file: File): Promise<{ lat: number; lng: number } | null> => {
    try {
      if (!isProbablyImageFile(file)) return null;
      const mod: any = await import("exifr");
      const exifr: any = mod?.default || mod;
      if (!exifr?.gps) return null;
      const buf = await readFileAsArrayBuffer(file);
      if (!buf) return null;
      const gps = await exifr
        .gps(buf)
        .catch(() => exifr.gps(file).catch(() => null));
      const lat = gps?.latitude ?? gps?.lat;
      const lng = gps?.longitude ?? gps?.lon ?? gps?.lng;
      return clampLatLng(Number(lat), Number(lng));
    } catch {
      return null;
    }
  };

  const extractCapturedAtFromImage = async (file: File): Promise<string | null> => {
    try {
      if (!isProbablyImageFile(file)) return null;
      const mod: any = await import("exifr");
      const exifr: any = mod?.default || mod;
      if (!exifr?.parse) return null;
      const exif = await exifr.parse(file, { gps: false, exif: true }).catch(() => null);
      const dt = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate || null;
      if (!dt) return null;
      try {
        const d = new Date(dt);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  };

  const maybeDownscaleImage = async (file: File): Promise<File> => {
    if (typeof document === 'undefined') return file;
    if (!isProbablyImageFile(file)) return file;
    // Preserve animated GIFs (canvas would flatten them)
    if (normalizeMime(String(file.type || "")) === 'image/gif' || getFileExt(file.name) === "gif") return file;

    const MAX_DIMENSION = Math.max(256, Math.floor(Number(maxImageDimension) || 1080));
    const QUALITY = Math.max(0.1, Math.min(1, Number(imageQuality) || 0.8));

    return await new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            try {
              URL.revokeObjectURL(img.src);
            } catch {
              // ignore
            }
            let { width, height } = img;
            if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
              resolve(file);
              return;
            }
            const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(file);
              return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  resolve(file);
                  return;
                }
                const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
                const newFile = new File([blob], `${baseName}-${MAX_DIMENSION}p.jpg`, {
                  type: 'image/jpeg',
                });
                resolve(newFile);
              },
              'image/jpeg',
              QUALITY
            );
          } catch {
            resolve(file);
          }
        };
        img.onerror = () => {
          try {
            URL.revokeObjectURL(img.src);
          } catch {
            // ignore
          }
          resolve(file);
        };
        img.src = URL.createObjectURL(file);
      } catch {
        resolve(file);
      }
    });
  };

  const uploadFile = async (attachment: Attachment) => {
    let { file } = attachment;
    // compress/reescalar imagens antes de subir
    file = await maybeDownscaleImage(file);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      throw new Error('Usuário não autenticado');
    }

    const prefix = pathPrefix ? `${pathPrefix.replace(/\/+$/,'')}/` : '';
    const filePath = `${prefix}${userData.user.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return { publicUrl, filePath, bucket };
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;

    const fileArray = Array.from(files);
    
    if (attachments.length + fileArray.length > maxFiles) {
      toast.error(`Máximo de ${maxFiles} arquivos permitidos`);
      return;
    }

    const newAttachments: Attachment[] = [];

    let imagesCount = attachments.filter((a) => isProbablyImageFile(a.file)).length;
    let videosCount = attachments.filter((a) => isProbablyVideoFile(a.file)).length;

    for (const file of fileArray) {
      if (isProbablyImageFile(file) && typeof maxImages === 'number' && maxImages >= 0) {
        if (imagesCount >= maxImages) {
          toast.error(`Máximo de ${maxImages} imagem(ns) por post`);
          continue;
        }
      }
      if (isProbablyVideoFile(file) && typeof maxVideos === 'number' && maxVideos >= 0) {
        if (videosCount >= maxVideos) {
          toast.error(`Máximo de ${maxVideos} vídeo(s) por post`);
          continue;
        }
      }
      const durError = await ensureVideoDurationOk(file);
      if (durError) {
        toast.error(durError);
        continue;
      }
      const error = validateFile(file);
      if (error) {
        toast.error(error);
        continue;
      }

      const preview = await createPreview(file);
      const exifGps = includeImageGpsMeta ? await extractGpsFromImage(file) : null;
      const exifCapturedAt = includeImageGpsMeta ? await extractCapturedAtFromImage(file) : null;
      
      newAttachments.push({
        id: Math.random().toString(36),
        file,
        preview,
        uploading: false,
        uploaded: false,
        progress: 0,
        meta: includeImageGpsMeta ? { exifGps, exifCapturedAt } : undefined,
      });

      if (isProbablyImageFile(file)) imagesCount += 1;
      if (isProbablyVideoFile(file)) videosCount += 1;
    }

    setAttachments(prev => [...prev, ...newAttachments]);

    // Iniciar uploads
    for (const attachment of newAttachments) {
      setAttachments(prev => prev.map(a => 
        a.id === attachment.id ? { ...a, uploading: true, progress: 30 } : a
      ));

      try {
        const { publicUrl, filePath, bucket: storageBucket } = await uploadFile(attachment);
        
        setAttachments(prev => prev.map(a => 
          a.id === attachment.id 
            ? { ...a, uploading: false, uploaded: true, progress: 100, url: publicUrl, filePath, bucket: storageBucket }
            : a
        ));
      } catch (error) {
        console.error('Upload error:', error);
        setAttachments(prev => prev.map(a => 
          a.id === attachment.id 
            ? { ...a, uploading: false, error: 'Erro ao fazer upload', progress: 0 }
            : a
        ));
        toast.error(`Erro ao fazer upload de ${attachment.file.name}`);
      }
    }
  }, [attachments, ensureVideoDurationOk, extractCapturedAtFromImage, extractGpsFromImage, includeImageGpsMeta, maxFiles, maxImages, maxVideos, validateFile]);

  // Atualizar callback quando anexos mudarem
  useEffect(() => {
    const uploadedUrls = attachments
      .filter(a => a.uploaded && a.url)
      .map(a => a.url!);
    const key = uploadedUrls.join("\n");
    if (key === lastUrlsKeyRef.current) return;
    lastUrlsKeyRef.current = key;
    try {
      onAttachmentsChangeRef.current(uploadedUrls);
    } catch {
      /* ignore */
    }
  }, [attachments]);

  useEffect(() => {
    const cb = onAttachmentItemsChangeRef.current;
    if (!cb) return;
    const items = attachments
      .filter((a) => a.uploaded && a.url)
      .map((a) => ({
        url: a.url as string,
        storageBucket: a.bucket,
        storagePath: a.filePath,
        filename: a.file?.name,
        contentType: a.file?.type,
        sizeBytes: a.file?.size,
        meta: a.meta,
      }));
    const key = items
      .map((i) => {
        const lat = i?.meta?.exifGps?.lat;
        const lng = i?.meta?.exifGps?.lng;
        const dt = i?.meta?.exifCapturedAt || "";
        return `${i.url}|${lat ?? ""}|${lng ?? ""}|${dt}`;
      })
      .join("\n");
    if (key === lastItemsKeyRef.current) return;
    lastItemsKeyRef.current = key;
    try {
      cb(items);
    } catch {
      /* ignore */
    }
  }, [attachments]);

  // Avisar se há uploads em andamento (para bloquear publicação, por exemplo)
  useEffect(() => {
    const cb = onUploadingChangeRef.current;
    if (!cb) return;
    const anyUploading = Boolean(attachments && attachments.length > 0 && attachments.some(a => a.uploading && !a.uploaded));
    if (lastUploadingRef.current === anyUploading) return;
    lastUploadingRef.current = anyUploading;
    try {
      cb(anyUploading);
    } catch {
      /* ignore */
    }
  }, [attachments]);

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const getFileIcon = (mimeType: string) => {
    const config = ALLOWED_TYPES[mimeType as keyof typeof ALLOWED_TYPES];
    const Icon = config?.icon || FileText;
    return <Icon className="w-5 h-5" />;
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-border",
          attachments.length >= maxFiles && "opacity-50 cursor-not-allowed"
        )}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-2">
          Arraste arquivos ou clique para selecionar
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Imagens, áudio, vídeo ou PDF • Máx {maxSizeMB}MB • Até {maxFiles} arquivos
          {typeof maxImages === 'number' ? ` • ${maxImages} imagem(ns)` : ''}
          {typeof maxVideos === 'number' ? ` • ${maxVideos} vídeo(s)` : ''}
          {maxVideoSeconds ? ` • Vídeos até ${maxVideoSeconds}s` : ''}
          {maxVideoDimension ? ` • Vídeos até ${maxVideoDimension}px` : ''}
          {maxImageDimension ? ` • Imagens otimizadas até ${maxImageDimension}px` : ''}
        </p>
        <input
          type="file"
          multiple
          accept={allowedMimeList.join(',')}
          onChange={(e) => handleFiles(e.target.files)}
          disabled={attachments.length >= maxFiles}
          className="hidden"
          id={inputId}
        />
        {cameraEnabled && (
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={attachments.length >= maxFiles}
            className="hidden"
            id={cameraInputId}
            {...(cameraCaptureValue ? { capture: cameraCaptureValue as any } : {})}
          />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={attachments.length >= maxFiles}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          Selecionar Arquivos
        </Button>
        {cameraEnabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={attachments.length >= maxFiles}
            onClick={() => document.getElementById(cameraInputId)?.click()}
            className="ml-2"
          >
            <Camera className="mr-2 h-4 w-4" />
            Tirar foto
          </Button>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card"
            >
              {attachment.preview ? (
                <img 
                  src={attachment.preview} 
                  alt={attachment.file.name}
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <div className="w-12 h-12 flex items-center justify-center rounded bg-muted">
                  {getFileIcon(attachment.file.type)}
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {attachment.file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(attachment.file.size / 1024 / 1024).toFixed(2)}MB
                </p>
                {attachment.uploading && (
                  <Progress value={attachment.progress} className="mt-1 h-1" />
                )}
                {attachment.error && (
                  <p className="text-xs text-destructive mt-1">{attachment.error}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {attachment.uploaded && (
                  <span className="text-xs text-green-600 dark:text-green-400">✓</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAttachment(attachment.id)}
                  disabled={attachment.uploading}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
