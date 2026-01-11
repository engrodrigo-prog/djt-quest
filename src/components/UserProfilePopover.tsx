import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/contexts/I18nContext";

type ProfileInfo = {
  id: string;
  name: string | null;
  operational_base: string | null;
  sigla_area: string | null;
  phone: string | null;
  avatar_url: string | null;
  avatar_thumbnail_url?: string | null;
  team_id?: string | null;
};

type UserProfilePopoverProps = {
  userId: string | null | undefined;
  name?: string | null;
  avatarUrl?: string | null;
  children: ReactElement;
};

const initials = (name: string | null | undefined) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const cleanPhone = (phone: string | null | undefined) => {
  if (!phone) return "";
  return String(phone).replace(/\D+/g, "");
};

export function UserProfilePopover({ userId, name, avatarUrl, children }: UserProfilePopoverProps) {
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);

  useEffect(() => {
    let active = true;
    if (!open || !userId) return;
    setLoading(true);
    setProfile(null);
    const loadProfile = async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, name, operational_base, sigla_area, phone, avatar_url, avatar_thumbnail_url, team_id")
          .eq("id", userId)
          .maybeSingle();
        if (!active) return;
        setProfile(data || null);
      } catch {
        if (!active) return;
        setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [open, userId]);

  const displayName = profile?.name || name || tr("userPopover.userFallback");
  const displayBase = profile?.operational_base || tr("userPopover.baseFallback");
  const displayPhone = profile?.phone || tr("userPopover.phoneFallback");
  const avatar = profile?.avatar_thumbnail_url || profile?.avatar_url || avatarUrl || null;
  const digits = useMemo(() => cleanPhone(profile?.phone), [profile?.phone]);
  const whatsappLinks = useMemo(() => {
    if (!digits) return null;
    return {
      app: `whatsapp://send?phone=${digits}`,
      web: `https://web.whatsapp.com/send?phone=${digits}`,
      mobile: `https://wa.me/${digits}`,
    };
  }, [digits]);
  const telUrl = digits ? `tel:${digits}` : null;
  const handleWhatsAppClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!whatsappLinks) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const isMobile =
      typeof navigator !== "undefined" &&
      ("userAgentData" in navigator
        ? Boolean((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile)
        : /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent));
    const fallbackUrl = isMobile ? whatsappLinks.mobile : whatsappLinks.web;
    const appUrl = whatsappLinks.app;

    let fallbackTimer: number | undefined;
    const clearFallback = () => {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearFallback();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    fallbackTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
      clearFallback();
    }, 800);

    window.location.href = appUrl;
  };

  if (!userId) return children;

  return (
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[420px]">
        <div className="flex items-start gap-4">
          <Avatar className="h-32 w-32">
            <AvatarImage src={avatar || undefined} alt={displayName} />
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {tr("userPopover.baseLabel")}: {displayBase}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {tr("userPopover.phoneLabel")}: {displayPhone}
            </p>
            {profile?.sigla_area ? (
              <p className="text-xs text-muted-foreground truncate">{profile.sigla_area}</p>
            ) : null}
          </div>
        </div>

        {loading && <p className="mt-3 text-xs text-muted-foreground">{tr("userPopover.loading")}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" asChild disabled={!telUrl}>
            <a href={telUrl || "#"} aria-disabled={!telUrl}>
              <Phone className="h-4 w-4 mr-1" />
              {tr("userPopover.call")}
            </a>
          </Button>
          <Button type="button" size="sm" asChild disabled={!whatsappLinks}>
            <a
              href={whatsappLinks?.app || "#"}
              onClick={handleWhatsAppClick}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!whatsappLinks}
            >
              <MessageCircle className="h-4 w-4 mr-1 text-green-500" />
              {tr("userPopover.whatsapp")}
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
