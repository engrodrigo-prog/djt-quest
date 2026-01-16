import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Upload, X, Image as ImageIcon, Music, Video, FileText, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const allowedMimeSet = new Set<string>(acceptMimeTypes && acceptMimeTypes.length > 0 ? acceptMimeTypes : Object.keys(ALLOWED_TYPES));
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
    if (!allowedMimeSet.has(file.type)) {
      return `Tipo de arquivo não permitido: ${file.type}`;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `Arquivo muito grande: ${(file.size / 1024 / 1024).toFixed(1)}MB (máx: ${maxSizeMB}MB)`;
    }
    return null;
  }, [maxSizeMB, allowedMimeSet]);

  const ensureVideoDurationOk = useCallback(async (file: File): Promise<string | null> => {
    if ((!maxVideoSeconds && !maxVideoDimension) || !file.type.startsWith('video/')) return null;
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
    if (!file.type.startsWith('image/')) return undefined;

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
    return { lat: la, lng: ln };
  };

  const extractGpsFromImage = async (file: File): Promise<{ lat: number; lng: number } | null> => {
    try {
      const t = String(file?.type || "");
      if (!t.startsWith("image/")) return null;
      const mod: any = await import("exifr");
      const exifr: any = mod?.default || mod;
      if (!exifr?.gps) return null;
      const gps = await exifr.gps(file).catch(() => null);
      const lat = gps?.latitude ?? gps?.lat;
      const lng = gps?.longitude ?? gps?.lon ?? gps?.lng;
      return clampLatLng(Number(lat), Number(lng));
    } catch {
      return null;
    }
  };

  const extractCapturedAtFromImage = async (file: File): Promise<string | null> => {
    try {
      const t = String(file?.type || "");
      if (!t.startsWith("image/")) return null;
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
    if (!file.type.startsWith('image/')) return file;
    // Preserve animated GIFs (canvas would flatten them)
    if (file.type === 'image/gif') return file;

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

    let imagesCount = attachments.filter((a) => a.file.type.startsWith('image/')).length;
    let videosCount = attachments.filter((a) => a.file.type.startsWith('video/')).length;

    for (const file of fileArray) {
      if (file.type.startsWith('image/') && typeof maxImages === 'number' && maxImages >= 0) {
        if (imagesCount >= maxImages) {
          toast.error(`Máximo de ${maxImages} imagem(ns) por post`);
          continue;
        }
      }
      if (file.type.startsWith('video/') && typeof maxVideos === 'number' && maxVideos >= 0) {
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

      if (file.type.startsWith('image/')) imagesCount += 1;
      if (file.type.startsWith('video/')) videosCount += 1;
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
          accept={(acceptMimeTypes && acceptMimeTypes.length ? acceptMimeTypes : Object.keys(ALLOWED_TYPES)).join(',')}
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
