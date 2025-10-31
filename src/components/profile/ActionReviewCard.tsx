import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Star, Clock } from "lucide-react";

interface ActionReviewCardProps {
  eventId: string;
}

interface Evaluation {
  id: string;
  evaluation_number: number;
  rating: number;
  final_rating: number | null;
  feedback_positivo: string;
  feedback_construtivo: string;
  created_at: string;
  reviewer: {
    name: string;
  };
}

export function ActionReviewCard({ eventId }: ActionReviewCardProps) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventData, setEventData] = useState<any>(null);

  useEffect(() => {
    loadEvaluations();
  }, [eventId]);

  const loadEvaluations = async () => {
    setLoading(true);
    try {
      // Buscar avaliações
      const { data: evals, error: evalsError } = await supabase
        .from('action_evaluations')
        .select(`
          *,
          reviewer:profiles!action_evaluations_reviewer_id_fkey(name)
        `)
        .eq('event_id', eventId)
        .order('evaluation_number');

      if (evalsError) throw evalsError;

      setEvaluations(evals || []);

      // Buscar dados do evento
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('status, final_points, retry_count')
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      setEventData(event);
    } catch (error) {
      console.error("Error loading evaluations:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary"></div>
            <span className="text-sm text-muted-foreground">Carregando avaliação...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (evaluations.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Aguardando Avaliação</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (evaluations.length === 1) {
    const eval1 = evaluations[0];
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="default">1ª Avaliação: {eval1.rating}/10</Badge>
          </CardTitle>
          <CardDescription>
            🕐 Aguardando 2ª avaliação...
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold">📝 Feedback Positivo:</p>
            <p className="text-sm text-muted-foreground">{eval1.feedback_positivo}</p>
          </div>
          {eval1.feedback_construtivo && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">💡 Feedback Construtivo:</p>
              <p className="text-sm text-muted-foreground">{eval1.feedback_construtivo}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Avaliado por: {eval1.reviewer?.name}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Duas avaliações completas
  const eval1 = evaluations[0];
  const eval2 = evaluations[1];
  const avgRating = eval2.final_rating || ((eval1.rating + eval2.rating) / 2);
  const finalXP = eventData?.final_points || 0;
  const retryCount = eventData?.retry_count || 0;
  
  const retryPenalty = retryCount === 0 ? 1.0 :
                       retryCount === 1 ? 0.8 :
                       retryCount === 2 ? 0.6 : 0.4;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">1ª: {eval1.rating}/10</Badge>
          <Badge variant="outline">2ª: {eval2.rating}/10</Badge>
          <Badge className="text-lg">
            📊 Média: {avgRating.toFixed(1)}/10
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Star className="h-4 w-4" />
          <AlertTitle>✅ Pontuação Final</AlertTitle>
          <AlertDescription>
            Você conquistou <strong>{finalXP} XP</strong> neste desafio!
            {retryPenalty < 1 && (
              <span className="text-muted-foreground block mt-1">
                ({Math.round(retryPenalty * 100)}% devido a {retryCount} {retryCount === 1 ? 'retry' : 'retries'})
              </span>
            )}
          </AlertDescription>
        </Alert>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="eval1">
            <AccordionTrigger>📝 Ver 1ª Avaliação ({eval1.rating}/10)</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Feedback Positivo:</p>
                <p className="text-sm text-muted-foreground">{eval1.feedback_positivo}</p>
              </div>
              {eval1.feedback_construtivo && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Feedback Construtivo:</p>
                  <p className="text-sm text-muted-foreground">{eval1.feedback_construtivo}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Avaliado por: {eval1.reviewer?.name}
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="eval2">
            <AccordionTrigger>📝 Ver 2ª Avaliação ({eval2.rating}/10)</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Feedback Positivo:</p>
                <p className="text-sm text-muted-foreground">{eval2.feedback_positivo}</p>
              </div>
              {eval2.feedback_construtivo && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Feedback Construtivo:</p>
                  <p className="text-sm text-muted-foreground">{eval2.feedback_construtivo}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Avaliado por: {eval2.reviewer?.name}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
