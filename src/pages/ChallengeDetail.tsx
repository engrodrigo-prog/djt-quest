import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Upload, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: string;
  xp_reward: number;
  require_two_leader_eval: boolean;
  campaign_id: string;
  evidence_required: boolean;
}

const ChallengeDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [description, setDescription] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);

  useEffect(() => {
    const loadChallenge = async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        toast({ title: 'Erro', description: 'Não foi possível carregar o desafio', variant: 'destructive' });
        navigate('/');
        return;
      }

      setChallenge(data);
      setLoading(false);
    };

    loadChallenge();
  }, [id, navigate, toast]);

  const handleSubmit = async () => {
    if (!challenge || !user) return;
    
    if (description.length < 50) {
      toast({ title: 'Erro', description: 'Descrição deve ter pelo menos 50 caracteres', variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('events')
        .insert([{
          user_id: user.id,
          challenge_id: challenge.id,
          payload: { description },
          evidence_urls: evidenceUrls.length > 0 ? evidenceUrls : null,
          status: challenge.require_two_leader_eval ? 'submitted' : 'evaluated'
        }]);

      if (error) throw error;

      toast({
        title: 'Sucesso!',
        description: challenge.require_two_leader_eval 
          ? 'Ação submetida! Aguardando avaliação de 2 líderes.' 
          : 'Desafio concluído!'
      });

      navigate('/');
    } catch (error) {
      console.error('Error submitting:', error);
      toast({ title: 'Erro', description: 'Não foi possível submeter a ação', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!challenge) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="container max-w-2xl mx-auto py-8 space-y-6">
        <Button variant="ghost" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <Badge>{challenge.type}</Badge>
              <span className="text-sm font-semibold text-accent">+{challenge.xp_reward} XP</span>
            </div>
            <CardTitle className="text-2xl">{challenge.title}</CardTitle>
            <CardDescription>{challenge.description}</CardDescription>
            {challenge.require_two_leader_eval && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4 p-3 bg-muted rounded-lg">
                <Shield className="h-4 w-4" />
                Este desafio requer avaliação de 2 líderes (1 Divisão + 1 Coordenação)
              </div>
            )}
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submeter Ação</CardTitle>
            <CardDescription>Descreva como você completou este desafio</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="description">Descrição da Ação *</Label>
              <Textarea
                id="description"
                placeholder="Descreva detalhadamente a ação realizada, contexto, resultados e aprendizados... (mínimo 50 caracteres)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {description.length}/50 caracteres mínimos
              </p>
            </div>

            {challenge.evidence_required && (
              <div>
                <Label htmlFor="evidence">Evidências (URLs)</Label>
                <Input
                  id="evidence"
                  placeholder="https://exemplo.com/foto.jpg"
                  onChange={(e) => {
                    const urls = e.target.value.split(',').map(u => u.trim()).filter(u => u);
                    setEvidenceUrls(urls);
                  }}
                  className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Separe múltiplas URLs com vírgula
                </p>
              </div>
            )}

            <Button 
              onClick={handleSubmit} 
              disabled={submitting || description.length < 50}
              className="w-full"
            >
              {submitting ? 'Submetendo...' : 'Submeter Ação'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ChallengeDetail;
