import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserProfilePopover } from "@/components/UserProfilePopover";

interface AvatarDisplayProps {
  userId?: string | null;
  avatarUrl?: string | null;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  sm: "w-10 h-10",
  md: "w-16 h-16",
  lg: "w-24 h-24",
  xl: "w-32 h-32",
};

const iconSizes = {
  sm: "h-5 w-5",
  md: "h-8 w-8",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
};

export const AvatarDisplay = ({
  userId,
  avatarUrl,
  name,
  size = "md",
  className,
}: AvatarDisplayProps) => {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const avatarNode = (
    <Avatar
      className={cn(
        sizeClasses[size],
        "ring-2 ring-primary/20 ring-offset-2 ring-offset-background"
      )}
    >
      <AvatarImage src={avatarUrl || undefined} alt={name} />
      <AvatarFallback className="bg-gradient-to-br from-primary/20 to-secondary/20">
        {avatarUrl ? initials : <User className={iconSizes[size]} />}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <div className={cn("relative", className)}>
      {userId ? (
        <UserProfilePopover userId={userId} name={name} avatarUrl={avatarUrl}>
          <button type="button" className="p-0 bg-transparent border-0">
            {avatarNode}
          </button>
        </UserProfilePopover>
      ) : (
        avatarNode
      )}
    </div>
  );
};
