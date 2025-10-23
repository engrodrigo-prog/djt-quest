import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Target, Zap, Trophy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TeamPerformanceManager } from '@/components/TeamPerformanceManager';

const Studio = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  
  // Campaign form
  const [campaignTitle, setCampaignTitle] = useState('');
  const [campaignDesc, setCampaignDesc] = useState('');
  const [campaignTag, setCampaignTag] = useState('');
  const [campaignStart, setCampaignStart] = useState('');
  const [campaignEnd, setCampaignEnd] = useState('');
  
  // Challenge form
  const [challengeTitle, setChallengeTitle] = useState('');
  const [challengeDesc, setChallengeDesc] = useState('');
  const [challengeType, setChallengeType] = useState('conhecimento');
  const [challengeXP, setChallengeXP] = useState('50');
  const [requireEval, setRequireEval] = useState(true);
  const [evidenceRequired, setEvidenceRequired] = useState(false);

  useEffect(() => {
    const loadUserRole = async () => {
      if (!user) return;

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (roleData) {
        setUserRole(roleData.role);
      }
      setLoading(false);
    };

    loadUserRole();
  }, [user]);

  const handleCreateCampaign = async () => {
    if (!campaignTitle || !campaignStart || !campaignEnd) {
      toast({ title: 'Erro', description: 'Preencha todos os campos obrigatórios', variant: 'destructive' });
      return;
    }

    try {
      const { error } = await supabase
        .from('campaigns')
        .insert({
          title: campaignTitle,
          description: campaignDesc,
          narrative_tag: campaignTag,
          start_date: campaignStart,
          end_date: campaignEnd,
          is_active: true
        });

      if (error) throw error;

      toast({ title: 'Sucesso!', description: 'Campanha criada com sucesso' });
      
      // Reset form
      setCampaignTitle('');
      setCampaignDesc('');
      setCampaignTag('');
      setCampaignStart('');
      setCampaignEnd('');
    } catch (error) {
      console.error('Error creating campaign:', error);
      toast({ title: 'Erro', description: 'Não foi possível criar a campanha', variant: 'destructive' });
    }
  };

  const handleCreateChallenge = async () => {
    if (!challengeTitle) {
      toast({ title: 'Erro', description: 'Título é obrigatório', variant: 'destructive' });
      return;
    }

    try {
      const { error } = await supabase
        .from('challenges')
        .insert([{
          title: challengeTitle,
          description: challengeDesc,
          type: challengeType as any,
          xp_reward: parseInt(challengeXP),
          require_two_leader_eval: requireEval,
          evidence_required: evidenceRequired
        }]);

      if (error) throw error;

      toast({ title: 'Sucesso!', description: 'Desafio criado com sucesso' });
      
      // Reset form
      setChallengeTitle('');
      setChallengeDesc('');
      setChallengeType('conhecimento');
      setChallengeXP('50');
      setRequireEval(true);
      setEvidenceRequired(false);
    } catch (error) {
      console.error('Error creating challenge:', error);
      toast({ title: 'Erro', description: 'Não foi possível criar o desafio', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!userRole || !['admin', 'gerente', 'lider_divisao', 'coordenador'].includes(userRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Apenas gestores e líderes podem acessar o DJT Go Studio.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="container mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Plus className="h-8 w-8 text-primary" />
            DJT Go Studio
          </h1>
          <p className="text-muted-foreground">Console de gestão de campanhas e desafios</p>
        </div>

        <Tabs defaultValue="campaigns" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="campaigns">
              <Target className="h-4 w-4 mr-2" />
              Campanhas
            </TabsTrigger>
            <TabsTrigger value="challenges">
              <Zap className="h-4 w-4 mr-2" />
              Desafios
            </TabsTrigger>
            <TabsTrigger value="performance">
              <Trophy className="h-4 w-4 mr-2" />
              Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Criar Nova Campanha</CardTitle>
                <CardDescription>
                  Campanhas são períodos temáticos com objetivos específicos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="camp-title">Título *</Label>
                  <Input
                    id="camp-title"
                    placeholder="Ex: Operação Zero Desligamentos"
                    value={campaignTitle}
                    onChange={(e) => setCampaignTitle(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="camp-desc">Descrição</Label>
                  <Textarea
                    id="camp-desc"
                    placeholder="Descreva os objetivos e contexto da campanha..."
                    value={campaignDesc}
                    onChange={(e) => setCampaignDesc(e.target.value)}
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="camp-tag">Tag Narrativa</Label>
                  <Input
                    id="camp-tag"
                    placeholder="Ex: NR10, DirecaoSegura, ZeroDesligamentos"
                    value={campaignTag}
                    onChange={(e) => setCampaignTag(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="camp-start">Data Início *</Label>
                    <Input
                      id="camp-start"
                      type="datetime-local"
                      value={campaignStart}
                      onChange={(e) => setCampaignStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="camp-end">Data Fim *</Label>
                    <Input
                      id="camp-end"
                      type="datetime-local"
                      value={campaignEnd}
                      onChange={(e) => setCampaignEnd(e.target.value)}
                    />
                  </div>
                </div>

                <Button onClick={handleCreateCampaign} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Campanha
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="challenges" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Criar Novo Desafio</CardTitle>
                <CardDescription>
                  Desafios são atividades específicas dentro de campanhas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="chal-title">Título *</Label>
                  <Input
                    id="chal-title"
                    placeholder="Ex: Quiz NR10 - Trabalhos em Altura"
                    value={challengeTitle}
                    onChange={(e) => setChallengeTitle(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="chal-desc">Descrição</Label>
                  <Textarea
                    id="chal-desc"
                    placeholder="Descreva o desafio e o que se espera do colaborador..."
                    value={challengeDesc}
                    onChange={(e) => setChallengeDesc(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="chal-type">Tipo</Label>
                    <Select value={challengeType} onValueChange={setChallengeType}>
                      <SelectTrigger id="chal-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conhecimento">Conhecimento</SelectItem>
                        <SelectItem value="habilidade">Habilidade</SelectItem>
                        <SelectItem value="atitude">Atitude</SelectItem>
                        <SelectItem value="seguranca">Segurança</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="chal-xp">Recompensa XP</Label>
                    <Input
                      id="chal-xp"
                      type="number"
                      value={challengeXP}
                      onChange={(e) => setChallengeXP(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="space-y-0.5">
                      <Label>Requer Avaliação 2L</Label>
                      <p className="text-xs text-muted-foreground">
                        Exige avaliação de 1 líder de Divisão + 1 de Coordenação
                      </p>
                    </div>
                    <Switch checked={requireEval} onCheckedChange={setRequireEval} />
                  </div>

                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="space-y-0.5">
                      <Label>Evidências Obrigatórias</Label>
                      <p className="text-xs text-muted-foreground">
                        Requer fotos ou documentos comprobatórios
                      </p>
                    </div>
                    <Switch checked={evidenceRequired} onCheckedChange={setEvidenceRequired} />
                  </div>
                </div>

                <Button onClick={handleCreateChallenge} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Desafio
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <TeamPerformanceManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Studio;
