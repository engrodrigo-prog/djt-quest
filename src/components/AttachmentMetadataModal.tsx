import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Camera, Image, MapPin, Clock, FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AttachmentMetadataModalProps {
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AttachmentMetadataModal = ({
  url,
  open,
  onOpenChange,
}: AttachmentMetadataModalProps) => {
  const { data: metadata, isLoading } = useQuery({
    queryKey: ['attachment-metadata', url],
    queryFn: async () => {
      const storagePath = url.split('/forum-attachments/')[1];
      if (!storagePath) return null;

      const { data, error } = await supabase
        .from('forum_attachment_metadata')
        .select('*')
        .eq('storage_path', storagePath)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detalhes do Anexo</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : metadata ? (
            <>
              {/* Informações Básicas */}
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <FileText className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Nome do arquivo</p>
                    <p className="text-sm text-muted-foreground">{metadata.original_filename}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Image className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Tipo</p>
                    <p className="text-sm text-muted-foreground">
                      {metadata.mime_type} • {formatFileSize(metadata.file_size)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Metadados de Imagem */}
              {metadata.file_type === 'image' && (
                <>
                  {(metadata.image_width || metadata.image_height) && (
                    <div className="flex items-start gap-2">
                      <Image className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Dimensões</p>
                        <p className="text-sm text-muted-foreground">
                          {metadata.image_width} × {metadata.image_height} pixels
                        </p>
                      </div>
                    </div>
                  )}

                  {metadata.capture_date && (
                    <div className="flex items-start gap-2">
                      <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Data da captura</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(metadata.capture_date), "PPp", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                  )}

                  {(metadata.device_make || metadata.device_model) && (
                    <div className="flex items-start gap-2">
                      <Camera className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Dispositivo</p>
                        <p className="text-sm text-muted-foreground">
                          {metadata.device_make} {metadata.device_model}
                        </p>
                      </div>
                    </div>
                  )}

                  {(metadata.gps_latitude && metadata.gps_longitude) && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Localização GPS</p>
                        <p className="text-sm text-muted-foreground">
                          {metadata.gps_latitude.toFixed(6)}, {metadata.gps_longitude.toFixed(6)}
                        </p>
                        <a
                          href={`https://www.google.com/maps?q=${metadata.gps_latitude},${metadata.gps_longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                        >
                          Ver no Google Maps →
                        </a>
                      </div>
                    </div>
                  )}

                  {metadata.ocr_text && (
                    <div className="flex items-start gap-2">
                      <FileText className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Texto detectado (OCR)</p>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {metadata.ocr_text}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Metadados de Áudio */}
              {metadata.file_type === 'audio' && metadata.audio_duration_seconds && (
                <div className="flex items-start gap-2">
                  <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Duração</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDuration(metadata.audio_duration_seconds)}
                    </p>
                  </div>
                </div>
              )}

              {metadata.transcription && (
                <div className="flex items-start gap-2">
                  <FileText className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Transcrição</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {metadata.transcription}
                    </p>
                  </div>
                </div>
              )}

              {metadata.processed_at && (
                <div className="pt-4 border-t">
                  <p className="text-xs text-muted-foreground">
                    Metadados processados em{' '}
                    {format(new Date(metadata.processed_at), "PPp", { locale: ptBR })}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum metadado disponível para este anexo.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
