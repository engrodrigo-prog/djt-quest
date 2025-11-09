import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, Upload, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AvatarCaptureProps {
  onCapture: (imageBase64: string) => void;
  onSkip?: () => void;
}

export const AvatarCapture = ({ onCapture, onSkip }: AvatarCaptureProps) => {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [hasConsented, setHasConsented] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (max 3MB) — evita exceder limite do Vercel para payloads
    if (file.size > 3 * 1024 * 1024) {
      alert("A imagem deve ter no máximo 3MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setCapturedImage(result);
    };
    reader.readAsDataURL(file);
  };

  const handleCapture = () => {
    if (!hasConsented) {
      setShowConsent(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleConfirm = () => {
    if (capturedImage) {
      onCapture(capturedImage);
      setCapturedImage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleConsentGiven = () => {
    setHasConsented(true);
    setShowConsent(false);
    fileInputRef.current?.click();
  };

  return (
    <>
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="p-6 space-y-4">
          {!capturedImage ? (
            <>
              <div className="aspect-square w-full bg-secondary/20 rounded-lg flex items-center justify-center border-2 border-dashed border-secondary">
                <div className="text-center space-y-2">
                  <Camera className="w-16 h-16 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Capture ou selecione uma foto
                  </p>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={handleCapture}
                  className="w-full"
                  variant="default"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Capturar ou enviar
                </Button>
                {onSkip && (
                  <Button onClick={onSkip} variant="outline" className="w-full">
                    Pular
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="relative aspect-square w-full rounded-lg overflow-hidden">
                <img
                  src={capturedImage}
                  alt="Avatar preview"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 border-4 border-primary/50 rounded-full" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={handleRetake}
                  variant="outline"
                  className="w-full"
                >
                  <X className="w-4 h-4 mr-2" />
                  Refazer
                </Button>
                <Button onClick={handleConfirm} className="w-full">
                  <Check className="w-4 h-4 mr-2" />
                  Confirmar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showConsent} onOpenChange={setShowConsent}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Consentimento de Uso de Imagem</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Sua foto será usada apenas para fins de personalização no DJT Go,
                  facilitando sua identificação na plataforma.
                </p>
                <p className="text-sm font-semibold">
                  Seus direitos (LGPD):
                </p>
                <ul className="text-sm list-disc pl-5 space-y-1">
                  <li>Seus dados serão usados apenas internamente</li>
                  <li>Você pode solicitar a exclusão a qualquer momento</li>
                  <li>Suas informações não serão compartilhadas externamente</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConsentGiven}>
              Li e Concordo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
