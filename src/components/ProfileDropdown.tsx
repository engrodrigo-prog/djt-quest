import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { Badge } from "@/components/ui/badge";
import { User, Settings, LogOut, Shield, Users, Camera, Key, Repeat, Languages, Volume2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { SUPPORTED_LOCALES, useI18n } from "@/contexts/I18nContext";
import { useSfx } from "@/lib/sfx";

interface ProfileDropdownProps {
  profile: {
    name: string;
    avatar_url: string | null;
    team?: { name: string } | null;
    tier: string;
    matricula?: string | null;
    email?: string | null;
  };
  isLeader: boolean;
  onSignOut: () => void;
}

export const ProfileDropdown = ({ profile, isLeader, onSignOut }: ProfileDropdownProps) => {
  const navigate = useNavigate();
  const { roleOverride, setRoleOverride } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const { enabled: sfxFeatureEnabled, muted: sfxMuted, volume: sfxVolume, setMuted: setSfxMuted, setVolume: setSfxVolume } = useSfx();
  const canImpersonate =
    profile?.matricula === "601555" ||
    (profile?.email || "").toLowerCase() === "rodrigonasc@cpfl.com.br";
  const currentMode =
    roleOverride === "lider"
      ? t("profile.menu.modeLeaderTest")
      : roleOverride === "colaborador"
      ? t("profile.menu.modeCollaboratorTest")
      : isLeader
      ? t("profile.menu.modeLeader")
      : t("profile.menu.modeCollaborator");

  const sfxPreset: "off" | "low" | "medium" | "high" =
    sfxMuted || sfxVolume <= 0.01 ? "off" : sfxVolume <= 0.35 ? "low" : sfxVolume <= 0.75 ? "medium" : "high";
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
          aria-label={t("profile.menu.open")}
        >
          <AvatarDisplay 
            avatarUrl={profile.avatar_url} 
            name={profile.name} 
            size="sm" 
          />
        </button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-64">
        {/* Cabeçalho com avatar e informações */}
        <DropdownMenuLabel>
          <div className="flex items-center gap-3">
            <AvatarDisplay 
              avatarUrl={profile.avatar_url} 
              name={profile.name} 
              size="md" 
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{profile.name}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">DJTX-{profile.team?.name || t("profile.menu.noTeam")}</span>
             </p>
              {isLeader && (
                <div className="mt-1">
                  <Badge 
                    variant="secondary"
                    className="cursor-pointer text-primary hover:bg-secondary/60"
                    onClick={() => navigate('/leader-dashboard')}
                  >
                    {t("profile.menu.leaderBadge")}
                  </Badge>
                </div>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                {isLeader ? (
                  <>
                    <Shield className="h-3 w-3 text-primary flex-shrink-0" />
                    <span className="text-primary font-medium">{currentMode}</span>
                  </>
                ) : (
                  <>
                    <User className="h-3 w-3 flex-shrink-0" />
                    <span>{currentMode}</span>
                  </>
                )}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        {/* Ações */}
        {canImpersonate && (
          <>
            {roleOverride && (
              <DropdownMenuItem
                onClick={() => {
                  setRoleOverride(null);
                  toast.success(t("profile.menu.impersonateBackToast"));
                }}
              >
                <Repeat className="h-4 w-4 mr-2" />
                {t("profile.menu.impersonateBack")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                setRoleOverride("lider");
                toast.message(t("profile.menu.impersonateLeaderToast"), {
                  description: t("profile.menu.impersonateLeaderDesc"),
                });
              }}
            >
              <Repeat className="h-4 w-4 mr-2" />
              {t("profile.menu.impersonateLeader")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setRoleOverride("colaborador");
                toast.message(t("profile.menu.impersonateCollaboratorToast"), {
                  description: t("profile.menu.impersonateCollaboratorDesc"),
                });
              }}
            >
              <Repeat className="h-4 w-4 mr-2" />
              {t("profile.menu.impersonateCollaborator")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages className="h-4 w-4 mr-2" />
            {t("common.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as any)}>
              {SUPPORTED_LOCALES.map((l) => (
                <DropdownMenuRadioItem key={l} value={l}>
                  {t(`locale.${l}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {sfxFeatureEnabled && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Volume2 className="h-4 w-4 mr-2" />
              {t("sfx.menu.sound")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={sfxPreset}
                onValueChange={(v) => {
                  const value = v as typeof sfxPreset;
                  if (value === "off") {
                    setSfxMuted(true);
                    return;
                  }
                  setSfxMuted(false);
                  if (value === "low") setSfxVolume(0.25);
                  if (value === "medium") setSfxVolume(0.6);
                  if (value === "high") setSfxVolume(1);
                }}
              >
                <DropdownMenuRadioItem value="off">{t("sfx.preset.off")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="low">{t("sfx.preset.low")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="medium">{t("sfx.preset.medium")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="high">{t("sfx.preset.high")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => navigate('/profile?avatar=open')}>
          <Camera className="h-4 w-4 mr-2" />
          {t("profile.menu.updatePhoto")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/profile')}>
          <User className="h-4 w-4 mr-2" />
          {t("profile.menu.viewProfile")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('open-password-dialog'))}>
          <Key className="h-4 w-4 mr-2" />
          {t("profile.menu.changePassword")}
        </DropdownMenuItem>
        
        <DropdownMenuItem disabled>
          <Settings className="h-4 w-4 mr-2" />
          <span>{t("profile.menu.settings")}</span>
          <span className="ml-auto text-xs text-muted-foreground">{t("profile.menu.comingSoon")}</span>
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4 mr-2" />
          {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
