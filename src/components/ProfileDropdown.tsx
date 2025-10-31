import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { User, Settings, LogOut, Shield, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ProfileDropdownProps {
  profile: {
    name: string;
    avatar_url: string | null;
    team?: { name: string } | null;
    tier: string;
  };
  isLeader: boolean;
  onSignOut: () => void;
}

export const ProfileDropdown = ({ profile, isLeader, onSignOut }: ProfileDropdownProps) => {
  const navigate = useNavigate();
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full">
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
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                {isLeader ? (
                  <>
                    <Shield className="h-3 w-3 text-primary flex-shrink-0" />
                    <span className="text-primary font-medium">Líder</span>
                  </>
                ) : (
                  <>
                    <User className="h-3 w-3 flex-shrink-0" />
                    <span>Colaborador</span>
                  </>
                )}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        {/* Ações */}
        <DropdownMenuItem onClick={() => navigate('/profile')}>
          <User className="h-4 w-4 mr-2" />
          Ver Perfil
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
