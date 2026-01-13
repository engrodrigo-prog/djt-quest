import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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
  const [profileConsent, setProfileConsent] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const shownForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    const uid = String(user?.id || "").trim();
    if (!uid) return;
    if (shownForUserRef.current === uid) return;
    shownForUserRef.current = uid;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("profiles").select("sepbook_gps_consent").eq("id", uid).maybeSingle();
        if (cancelled) return;
        const v = (data as any)?.sepbook_gps_consent;
        if (typeof v === "boolean") {
          setProfileConsent(v);
          return;
        }
        // Fallback to local storage (legacy cache)
        if (readConsent() === "allow") {
          setProfileConsent(true);
          try {
            await supabase.from("profiles").update({ sepbook_gps_consent: true } as any).eq("id", uid);
          } catch {
            /* ignore */
          }
          return;
        }
        setProfileConsent(null);
        setOpen(true);
      } catch {
        if (cancelled) return;
        if (readConsent() === "allow") {
          setProfileConsent(true);
          return;
        }
        setProfileConsent(null);
        setOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user?.id]);

  if (!user?.id) return null;
  if (profileConsent !== null) return null;

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
              const uid = String(user?.id || "").trim();
              if (!uid || saving) return;
              setSaving(true);
              (async () => {
                try {
                  await supabase.from("profiles").update({ sepbook_gps_consent: false } as any).eq("id", uid);
                  clearConsent();
                  setProfileConsent(false);
                  setOpen(false);
                  toast({ title: tr("sepbook.gpsConsentTitle"), description: tr("sepbook.gpsConsentDenyFeedback") });
                } catch {
                  toast({ title: tr("sepbook.gpsConsentTitle"), description: tr("common.error"), variant: "destructive" });
                } finally {
                  setSaving(false);
                }
              })();
            }}
            disabled={saving}
          >
            {tr("sepbook.gpsConsentDeny")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              const uid = String(user?.id || "").trim();
              if (!uid || saving) return;
              setSaving(true);
              (async () => {
                try {
                  await supabase.from("profiles").update({ sepbook_gps_consent: true } as any).eq("id", uid);
                  writeAllow();
                  setProfileConsent(true);
                  setOpen(false);
                  toast({ title: tr("sepbook.gpsConsentTitle"), description: tr("sepbook.gpsConsentAllowFeedback") });
                } catch {
                  toast({ title: tr("sepbook.gpsConsentTitle"), description: tr("common.error"), variant: "destructive" });
                } finally {
                  setSaving(false);
                }
              })();
            }}
            disabled={saving}
          >
            {tr("sepbook.gpsConsentAllow")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
