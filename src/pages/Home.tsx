import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import djtCover from '@/assets/backgrounds/djt-quest-cover.png';

const Home = () => {
  const navigate = useNavigate();
  const { /* hasActiveSession, */ loading } = useAuth();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && pendingRedirect) {
      navigate(pendingRedirect);
      setPendingRedirect(null);
    }
  }, [loading, pendingRedirect, navigate]);

  const handleGo = () => {
    setIsTransitioning(true);
    // Always navigate to dashboard; ProtectedRoute handles auth redirects
    const target = '/dashboard';

    if (loading) {
      setPendingRedirect(target);
      return;
    }

    navigate(target);
  };

  return (
    <div 
      className={`min-h-screen flex flex-col items-center justify-end p-8 pb-16 relative overflow-hidden ${isTransitioning ? 'animate-page-fade-out' : ''}`}
      style={{
        backgroundImage: `url(${djtCover})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Bottom Section */}
      <div className="relative z-10 flex flex-col items-center gap-8 mb-4 animate-fade-in">
        {/* GO Button - Gigante */}
        <Button 
          onClick={handleGo}
          disabled={isTransitioning}
          size="lg"
          className={`h-24 px-20 text-4xl font-bold rounded-2xl bg-gradient-to-r from-primary to-secondary shadow-[0_10px_50px_rgba(0,0,0,0.4)] group ${
            isTransitioning 
              ? 'animate-slide-fade-left cursor-not-allowed' 
              : 'hover:scale-110 hover:shadow-[0_0_60px_rgba(255,215,0,0.5)] transition-all duration-300'
          }`}
        >
          <Play className="mr-3 h-12 w-12 group-hover:translate-x-1 transition-transform" />
          GO
        </Button>

        {/* Badges - Minimalistas */}
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <span className="border-2 border-white/50 bg-white/5 px-6 py-2.5 rounded-full font-medium uppercase tracking-wide text-white">
            Conhecimento
          </span>
          <span className="border-2 border-white/50 bg-white/5 px-6 py-2.5 rounded-full font-medium uppercase tracking-wide text-white">
            Habilidade
          </span>
          <span className="border-2 border-white/50 bg-white/5 px-6 py-2.5 rounded-full font-medium uppercase tracking-wide text-white">
            Atitude
          </span>
          <span className="border-2 border-white/50 bg-white/5 px-6 py-2.5 rounded-full font-medium uppercase tracking-wide text-white">
            Segurança
          </span>
        </div>
      </div>
    </div>
  );
};

export default Home;
