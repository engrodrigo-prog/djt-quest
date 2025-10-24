import { Shield, Star, Award } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getTierInfo, getTierColor } from '@/lib/constants/tiers';

interface TierBadgeProps {
  tierCode: string;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export const TierBadge = ({ tierCode, size = 'md', showIcon = true }: TierBadgeProps) => {
  const info = getTierInfo(tierCode);
  if (!info) return null;

  const Icon = info.icon === 'Star' ? Star : info.icon === 'Award' ? Award : Shield;
  
  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2'
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5'
  };

  return (
    <Badge className={`${getTierColor(tierCode)} ${sizeClasses[size]} font-semibold border-2`}>
      {showIcon && <Icon className={`mr-1.5 ${iconSizes[size]}`} />}
      {info.name}
    </Badge>
  );
};
