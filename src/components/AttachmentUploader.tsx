import { useState, useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Upload, X, Image, Music, Video, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface Attachment {
  id: string;
  file: File;
  preview?: string;
  uploading: boolean;
  uploaded: boolean;
  progress: number;
  url?: string;
  error?: string;
}

interface AttachmentUploaderProps {
  onAttachmentsChange: (urls: string[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  /** Optional list of MIME types to accept; defaults to internal ALLOWED_TYPES */
  acceptMimeTypes?: string[];
  /** Storage bucket to upload to. Defaults to 'forum-attachments' */
  bucket?: string;
  /** Optional path prefix inside the bucket (e.g., 'campaigns', 'challenges') */
  pathPrefix?: string;
  /** Hint to open camera on mobile: 'environment' (back), 'user' (front) or true */
  capture?: boolean | 'environment' | 'user';
}

const ALLOWED_TYPES = {
  'image/jpeg': { icon: Image, label: 'Imagem' },
  'image/png': { icon: Image, label: 'Imagem' },
  'image/gif': { icon: Image, label: 'Imagem' },
  'image/webp': { icon: Image, label: 'Imagem' },
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
  maxFiles = 10,
  maxSizeMB = 50,
  acceptMimeTypes,
  bucket = 'forum-attachments',
  pathPrefix = '',
  capture,
}: AttachmentUploaderProps) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const allowedMimeSet = new Set<string>(acceptMimeTypes && acceptMimeTypes.length > 0 ? acceptMimeTypes : Object.keys(ALLOWED_TYPES));
  const inputId = useMemo(() => `file-upload-${Math.random().toString(36).slice(2)}`, []);

  const validateFile = useCallback((file: File): string | null => {
    if (!allowedMimeSet.has(file.type)) {
      return `Tipo de arquivo não permitido: ${file.type}`;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `Arquivo muito grande: ${(file.size / 1024 / 1024).toFixed(1)}MB (máx: ${maxSizeMB}MB)`;
    }
    return null;
  }, [maxSizeMB, allowedMimeSet]);

  const createPreview = async (file: File): Promise<string | undefined> => {
    if (!file.type.startsWith('image/')) return undefined;
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    });
  };

  const uploadFile = async (attachment: Attachment) => {
    const { file } = attachment;
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

    return { publicUrl, filePath };
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;

    const fileArray = Array.from(files);
    
    if (attachments.length + fileArray.length > maxFiles) {
      toast.error(`Máximo de ${maxFiles} arquivos permitidos`);
      return;
    }

    const newAttachments: Attachment[] = [];

    for (const file of fileArray) {
      const error = validateFile(file);
      if (error) {
        toast.error(error);
        continue;
      }

      const preview = await createPreview(file);
      
      newAttachments.push({
        id: Math.random().toString(36),
        file,
        preview,
        uploading: false,
        uploaded: false,
        progress: 0
      });
    }

    setAttachments(prev => [...prev, ...newAttachments]);

    // Iniciar uploads
    for (const attachment of newAttachments) {
      setAttachments(prev => prev.map(a => 
        a.id === attachment.id ? { ...a, uploading: true, progress: 30 } : a
      ));

      try {
        const { publicUrl } = await uploadFile(attachment);
        
        setAttachments(prev => prev.map(a => 
          a.id === attachment.id 
            ? { ...a, uploading: false, uploaded: true, progress: 100, url: publicUrl }
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
  }, [attachments, maxFiles, validateFile]);

  // Atualizar callback quando anexos mudarem
  useEffect(() => {
    const uploadedUrls = attachments
      .filter(a => a.uploaded && a.url)
      .map(a => a.url!);
    onAttachmentsChange(uploadedUrls);
  }, [attachments, onAttachmentsChange]);

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
        </p>
        <input
          type="file"
          multiple
          accept={(acceptMimeTypes && acceptMimeTypes.length ? acceptMimeTypes : Object.keys(ALLOWED_TYPES)).join(',')}
          onChange={(e) => handleFiles(e.target.files)}
          disabled={attachments.length >= maxFiles}
          className="hidden"
          id={inputId}
          {...(capture ? { capture: typeof capture === 'boolean' ? undefined : capture } : {})}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={attachments.length >= maxFiles}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          Selecionar Arquivos
        </Button>
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
