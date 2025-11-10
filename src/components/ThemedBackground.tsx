import { Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import appBg from '@/assets/backgrounds/BG.png'

type ThemeKey = 'conhecimento' | 'habilidades' | 'atitude' | 'seguranca'

const themeMap: Record<ThemeKey, { from: string; via?: string; to: string; ring: string }> = {
  conhecimento: { from: 'from-indigo-600/25', via: 'via-violet-500/20', to: 'to-sky-500/15', ring: 'ring-indigo-400/30' },
  habilidades:  { from: 'from-emerald-600/25', via: 'via-teal-500/20',   to: 'to-green-500/15', ring: 'ring-emerald-400/30' },
  atitude:      { from: 'from-rose-600/25',    via: 'via-orange-500/20', to: 'to-amber-500/15', ring: 'ring-rose-400/30' },
  seguranca:    { from: 'from-amber-600/25',   via: 'via-yellow-500/20', to: 'to-stone-500/10', ring: 'ring-amber-400/30' },
}

interface BGProps {
  theme: ThemeKey
  className?: string
  fixed?: boolean
  fit?: 'cover' | 'contain'
  repeat?: 'no-repeat' | 'repeat' | 'repeat-y'
}

export function ThemedBackground({ theme, className, fixed = true, fit = 'cover', repeat = 'no-repeat' }: BGProps) {
  const t = themeMap[theme]
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none inset-0 overflow-hidden',
        fixed ? 'fixed' : 'absolute',
        className,
      )}
      style={{ zIndex: 0 }}
    >
      {/* Background image */}
      <div
        className="absolute inset-0"
        style={{ 
          backgroundImage: `url(${appBg})`,
          backgroundSize: fit,
          backgroundPosition: 'center',
          backgroundRepeat: repeat,
        }}
      />

      {/* Gradient overlay for theme tint */}
      <div className={cn('absolute inset-0 bg-gradient-to-br animate-gradientShift mix-blend-multiply', t.from, t.via, t.to)} />

      {/* Soft vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.06),transparent_35%),radial-gradient(circle_at_0%_80%,rgba(255,255,255,0.05),transparent_35%)]" />

      {/* Floating orbs */}
      <div className={cn('absolute -top-10 -left-10 w-64 h-64 rounded-full opacity-25 animate-floatSlow', t.ring, 'ring-8')} />
      <div className={cn('absolute bottom-[-3rem] right-[-2rem] w-72 h-72 rounded-full opacity-20 animate-floatSlow2', t.ring, 'ring-8')} />

      {/* Guardian of Life motif: subtle shields grid */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute left-6 top-8 animate-pulseSoft">
          <Shield className="h-10 w-10" />
        </div>
        <div className="absolute right-10 top-16 animate-pulseSoft delay-1000">
          <Shield className="h-12 w-12" />
        </div>
        <div className="absolute left-1/2 bottom-10 -translate-x-1/2 animate-pulseSoft delay-700">
          <Shield className="h-16 w-16" />
        </div>
      </div>
    </div>
  )
}

export function domainFromType(type?: string): ThemeKey {
  const t = (type || '').toLowerCase()
  if (t.includes('quiz')) return 'conhecimento'
  if (t.includes('forum') || t.includes('mento') || t.includes('atitude')) return 'atitude'
  if (t.includes('safety') || t.includes('segur')) return 'seguranca'
  return 'habilidades'
}
