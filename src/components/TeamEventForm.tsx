import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { Zap, Gift, AlertTriangle, Building2, ChevronRight } from 'lucide-react';

export function TeamEventForm() {
  const { user, orgScope, userRole } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [eventType, setEventType] = useState<'reconhecimento' | 'ponto_atencao'>('reconhecimento');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !orgScope?.teamId) {
      toast({
        title: 'Erro',
        description: 'Você precisa estar vinculado a uma equipe',
        variant: 'destructive'
      });
      return;
    }

    // Validar pontos apenas para reconhecimento
    if (eventType === 'reconhecimento' && (!points || parseInt(points) <= 0)) {
      toast({
        title: 'Erro',
        description: 'Pontos devem ser um número positivo para reconhecimento',
        variant: 'destructive'
      });
      return;
    }

    if (reason.length < 50) {
      toast({
        title: 'Erro',
        description: 'A justificativa deve ter no mínimo 50 caracteres',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);

    try {
      const { data: session } = await supabase.auth.getSession();
      
      const { data, error } = await supabase.functions.invoke('create-team-event', {
        body: {
          teamId: orgScope.teamId,
          eventType,
          points: eventType === 'reconhecimento' ? parseInt(points) : 0,
          reason
        },
        headers: {
          Authorization: `Bearer ${session.session?.access_token}`
        }
      });

      if (error) throw error;

      toast({
        title: 'Sucesso!',
        description: data.message || `${eventType === 'reconhecimento' ? '🎉 Reconhecimento' : '⚠️ Ponto de atenção'} registrado para a equipe`
      });

      // Reset form
      setPoints('');
      setReason('');
      setEventType('reconhecimento');
    } catch (error: any) {
      console.error('Error creating team event:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao criar evento de equipe',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Evento de Equipe
        </CardTitle>
        <CardDescription>
          Registre reconhecimentos (com XP) ou pontos de atenção (sem XP) para sua equipe
        </CardDescription>
        {orgScope && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 pt-2 border-t">
            <Building2 className="h-4 w-4" />
            <span className="text-xs">Sua equipe: {orgScope.teamName || 'Carregando...'}</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <Label>Tipo de Evento</Label>
            <RadioGroup value={eventType} onValueChange={(v) => setEventType(v as 'reconhecimento' | 'ponto_atencao')}>
              <div className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value="reconhecimento" id="reconhecimento" />
                <Label htmlFor="reconhecimento" className="flex items-center gap-2 cursor-pointer flex-1">
                  <Gift className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="font-semibold">✅ Reconhecimento</p>
                    <p className="text-xs text-muted-foreground">Bonificar equipe com XP adicional</p>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value="ponto_atencao" id="ponto_atencao" />
                <Label htmlFor="ponto_atencao" className="flex items-center gap-2 cursor-pointer flex-1">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <div>
                    <p className="font-semibold">⚠️ Ponto de Atenção</p>
                    <p className="text-xs text-muted-foreground">Registrar evento sem bonificação</p>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {eventType === 'reconhecimento' && (
            <div className="space-y-2">
              <Label htmlFor="points">Quantidade de Pontos</Label>
              <Input
                id="points"
                type="number"
                min="1"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="Ex: 50"
                required
              />
            </div>
          )}
          
          {eventType === 'ponto_atencao' && (
            <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <p className="text-sm text-muted-foreground">
                ⚠️ Ponto de atenção não adiciona XP. Serve apenas para registrar o evento.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">Justificativa (mínimo 50 caracteres)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo detalhado para este evento..."
              rows={4}
              className="resize-none"
              required
            />
            <p className="text-xs text-muted-foreground">
              {reason.length}/50 caracteres
            </p>
          </div>

          <Button 
            type="submit" 
            disabled={loading || (eventType === 'reconhecimento' && !points) || reason.length < 50}
            className="w-full"
          >
            {loading ? 'Processando...' : `Registrar ${eventType === 'reconhecimento' ? 'Reconhecimento' : 'Ponto de Atenção'}`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
