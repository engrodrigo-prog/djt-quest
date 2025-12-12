import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { Badge } from "@/components/ui/badge";
import { User, Settings, LogOut, Shield, Users, Camera, Key, Repeat } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

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
  const canImpersonate =
    profile?.matricula === "601555" ||
    (profile?.email || "").toLowerCase() === "rodrigonasc@cpfl.com.br";
  const currentMode =
    roleOverride === "lider"
      ? "Modo líder (teste)"
      : roleOverride === "colaborador"
      ? "Modo colaborador (teste)"
      : isLeader
      ? "Líder"
      : "Colaborador";
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
          aria-label="Abrir menu do perfil"
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
                <span className="truncate">DJTX-{profile.team?.name || 'Sem equipe'}</span>
             </p>
              {isLeader && (
                <div className="mt-1">
                  <Badge 
                    variant="secondary"
                    className="cursor-pointer text-primary hover:bg-secondary/60"
                    onClick={() => navigate('/leader-dashboard')}
                  >
                    Líder
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
              <DropdownMenuItem onClick={() => setRoleOverride(null)}>
                <Repeat className="h-4 w-4 mr-2" />
                Voltar ao papel real
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => setRoleOverride("lider")}
            >
              <Repeat className="h-4 w-4 mr-2" />
              Navegar como Líder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRoleOverride("colaborador")}>
              <Repeat className="h-4 w-4 mr-2" />
              Navegar como Colaborador
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => navigate('/profile?avatar=open')}>
          <Camera className="h-4 w-4 mr-2" />
          Atualizar Foto
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/profile')}>
          <User className="h-4 w-4 mr-2" />
          Ver Perfil
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('open-password-dialog'))}>
          <Key className="h-4 w-4 mr-2" />
          Alterar Senha
        </DropdownMenuItem>
        
        <DropdownMenuItem disabled>
          <Settings className="h-4 w-4 mr-2" />
          <span>Configurações</span>
          <span className="ml-auto text-xs text-muted-foreground">(em breve)</span>
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
