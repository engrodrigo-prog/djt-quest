import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useToast } from "@/hooks/use-toast";

const STORAGE_SEPBOOK_LOCATION_CONSENT = "sepbook_location_consent"; // 'allow'

const readConsent = (): "allow" | "unknown" => {
  try {
    const raw = localStorage.getItem(STORAGE_SEPBOOK_LOCATION_CONSENT);
    if (raw === "allow") return "allow";
    if (raw === "deny") localStorage.removeItem(STORAGE_SEPBOOK_LOCATION_CONSENT);
    return "unknown";
  } catch {
    return "unknown";
  }
};

const writeAllow = () => {
  try {
    localStorage.setItem(STORAGE_SEPBOOK_LOCATION_CONSENT, "allow");
  } catch {
    /* ignore */
  }
};

const clearConsent = () => {
  try {
    localStorage.removeItem(STORAGE_SEPBOOK_LOCATION_CONSENT);
  } catch {
    /* ignore */
  }
};

export function SepbookGpsConsentPrompt() {
  const { toast } = useToast();
  const { t: tr } = useI18n();
  const { user, loading } = useAuth() as any;
  const [open, setOpen] = useState(false);
  const shownForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    const uid = String(user?.id || "").trim();
    if (!uid) return;
    if (shownForUserRef.current === uid) return;
    if (readConsent() === "allow") return;
    shownForUserRef.current = uid;
    setOpen(true);
  }, [loading, user?.id]);

  if (!user?.id) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("sepbook.gpsConsentTitle")}</DialogTitle>
          <DialogDescription>{tr("sepbook.gpsConsentDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearConsent();
              setOpen(false);
              toast({ title: tr("sepbook.gpsConsentTitle"), description: tr("sepbook.gpsConsentDenyFeedback") });
            }}
          >
            {tr("sepbook.gpsConsentDeny")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              writeAllow();
              setOpen(false);
              toast({ title: tr("sepbook.gpsConsentTitle"), description: tr("sepbook.gpsConsentAllowFeedback") });
            }}
          >
            {tr("sepbook.gpsConsentAllow")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
