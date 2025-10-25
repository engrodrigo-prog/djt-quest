import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download, Info } from "lucide-react";
import { AttachmentMetadataModal } from "./AttachmentMetadataModal";

interface AttachmentViewerProps {
  urls: string[];
  postId?: string;
}

const getFileType = (url: string): 'image' | 'audio' | 'video' | 'document' => {
  const ext = url.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image';
  if (['mp3', 'wav', 'ogg', 'webm', 'm4a'].includes(ext || '')) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(ext || '')) return 'video';
  return 'document';
};

export const AttachmentViewer = ({ urls, postId }: AttachmentViewerProps) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [metadataUrl, setMetadataUrl] = useState<string | null>(null);

  const images = urls.filter(url => getFileType(url) === 'image');
  const audioFiles = urls.filter(url => getFileType(url) === 'audio');
  const videoFiles = urls.filter(url => getFileType(url) === 'video');
  const documents = urls.filter(url => getFileType(url) === 'document');

  const openLightbox = (index: number) => {
    setSelectedIndex(index);
    setLightboxOpen(true);
  };

  const navigateLightbox = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    } else {
      setSelectedIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {/* Galeria de Imagens */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {images.map((url, index) => (
            <div key={url} className="relative group">
              <img
                src={url}
                alt={`Anexo ${index + 1}`}
                className="w-full h-32 object-cover rounded-lg cursor-pointer transition-opacity hover:opacity-90"
                onClick={() => openLightbox(index)}
              />
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setMetadataUrl(url);
                }}
              >
                <Info className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Players de Áudio */}
      {audioFiles.length > 0 && (
        <div className="space-y-2">
          {audioFiles.map((url, index) => (
            <div key={url} className="flex items-center gap-2 p-3 rounded-lg bg-muted">
              <audio controls className="flex-1">
                <source src={url} />
                Seu navegador não suporta áudio.
              </audio>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMetadataUrl(url)}
              >
                <Info className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Players de Vídeo */}
      {videoFiles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {videoFiles.map((url) => (
            <div key={url} className="relative group">
              <video
                controls
                className="w-full rounded-lg"
                preload="metadata"
              >
                <source src={url} />
                Seu navegador não suporta vídeo.
              </video>
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setMetadataUrl(url)}
              >
                <Info className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Links para Documentos */}
      {documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((url) => {
            const filename = url.split('/').pop() || 'documento.pdf';
            return (
              <div key={url} className="flex items-center gap-2 p-3 rounded-lg border">
                <div className="flex-1">
                  <p className="text-sm font-medium">{filename}</p>
                  <p className="text-xs text-muted-foreground">PDF</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={url} download target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" />
                    Baixar
                  </a>
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox para Imagens */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-4xl w-full p-0">
          <div className="relative">
            <img
              src={images[selectedIndex]}
              alt={`Imagem ${selectedIndex + 1}`}
              className="w-full h-auto max-h-[80vh] object-contain"
            />
            <div className="absolute top-4 right-4 flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMetadataUrl(images[selectedIndex])}
              >
                <Info className="w-4 h-4 mr-2" />
                Detalhes
              </Button>
              <Button
                variant="secondary"
                size="sm"
                asChild
              >
                <a href={images[selectedIndex]} download>
                  <Download className="w-4 h-4" />
                </a>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLightboxOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            {images.length > 1 && (
              <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-4">
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => navigateLightbox('prev')}
                  className="rounded-full"
                >
                  ←
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => navigateLightbox('next')}
                  className="rounded-full"
                >
                  →
                </Button>
              </div>
            )}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
              {selectedIndex + 1} / {images.length}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Metadados */}
      {metadataUrl && (
        <AttachmentMetadataModal
          url={metadataUrl}
          open={!!metadataUrl}
          onOpenChange={(open) => !open && setMetadataUrl(null)}
        />
      )}
    </div>
  );
};
