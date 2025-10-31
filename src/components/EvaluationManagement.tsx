import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface EvaluationItem {
  id: string;
  event_id: string;
  assigned_to: string | null;
  created_at: string;
  assigned_at: string | null;
  event: {
    challenge: { title: string };
    user: { name: string };
    status: string;
    first_evaluation_rating: number | null;
  };
  reviewer: { name: string } | null;
}

interface EvaluationCounts {
  pending_first: number;
  pending_second: number;
  completed: number;
}

export default function EvaluationManagement() {
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<EvaluationCounts>({
    pending_first: 0,
    pending_second: 0,
    completed: 0
  });
  const [pendingFirst, setPendingFirst] = useState<EvaluationItem[]>([]);
  const [pendingSecond, setPendingSecond] = useState<EvaluationItem[]>([]);
  const [completed, setCompleted] = useState<EvaluationItem[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    loadEvaluations();
  }, []);

  const loadEvaluations = async () => {
    setLoading(true);
    try {
      // Buscar avaliações pendentes (1ª)
      const { data: firstPending } = await supabase
        .from('evaluation_queue')
        .select(`
          *,
          event:events(
            challenge:challenges(title),
            user:profiles!events_user_id_fkey(name),
            status,
            first_evaluation_rating
          ),
          reviewer:profiles!evaluation_queue_assigned_to_fkey(name)
        `)
        .is('completed_at', null)
        .order('created_at', { ascending: false });

      // Filtrar por 1ª e 2ª avaliação baseado no status do evento
      const first = firstPending?.filter(
        e => e.event?.status === 'submitted' && !e.event.first_evaluation_rating
      ) || [];
      
      const second = firstPending?.filter(
        e => e.event?.status === 'awaiting_second_evaluation' && e.event.first_evaluation_rating
      ) || [];

      setPendingFirst(first);
      setPendingSecond(second);

      // Buscar avaliações completas (últimas 50)
      const { data: completedData } = await supabase
        .from('evaluation_queue')
        .select(`
          *,
          event:events(
            challenge:challenges(title),
            user:profiles!events_user_id_fkey(name),
            status,
            first_evaluation_rating
          ),
          reviewer:profiles!evaluation_queue_assigned_to_fkey(name)
        `)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(50);

      setCompleted(completedData || []);

      setCounts({
        pending_first: first.length,
        pending_second: second.length,
        completed: completedData?.length || 0
      });

    } catch (error) {
      console.error("Error loading evaluations:", error);
      toast({
        title: "Erro ao carregar avaliações",
        description: "Não foi possível carregar a lista de avaliações.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async (queueId: string) => {
    try {
      const { error } = await supabase
        .from('evaluation_queue')
        .update({ assigned_to: null, assigned_at: null })
        .eq('id', queueId);

      if (error) throw error;

      toast({
        title: "Reatribuição solicitada",
        description: "A avaliação será reatribuída automaticamente.",
      });

      loadEvaluations();
    } catch (error) {
      console.error("Error reassigning:", error);
      toast({
        title: "Erro ao reatribuir",
        description: "Não foi possível reatribuir a avaliação.",
        variant: "destructive"
      });
    }
  };

  const renderTable = (data: EvaluationItem[], showEvalNumber: boolean = false) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Colaborador</TableHead>
          <TableHead>Desafio</TableHead>
          {showEvalNumber && <TableHead>1ª Nota</TableHead>}
          <TableHead>Atribuído a</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showEvalNumber ? 6 : 5} className="text-center text-muted-foreground py-8">
              Nenhuma avaliação nesta categoria
            </TableCell>
          </TableRow>
        ) : (
          data.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">
                {item.event?.user?.name || 'N/A'}
              </TableCell>
              <TableCell>{item.event?.challenge?.title || 'N/A'}</TableCell>
              {showEvalNumber && (
                <TableCell>
                  {item.event?.first_evaluation_rating ? (
                    <Badge variant="outline">
                      {item.event.first_evaluation_rating}/10
                    </Badge>
                  ) : '-'}
                </TableCell>
              )}
              <TableCell>{item.reviewer?.name || 'Não atribuído'}</TableCell>
              <TableCell>
                {new Date(item.created_at).toLocaleDateString('pt-BR')}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/evaluations?event=${item.event_id}`)}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Ver
                  </Button>
                  {item.assigned_to && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleReassign(item.id)}
                    >
                      Reatribuir
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Gerenciar Avaliações</h2>
        <p className="text-muted-foreground">
          Acompanhe e gerencie a fila de avaliações pendentes
        </p>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">1ª Avaliação Pendente</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.pending_first}</div>
            <p className="text-xs text-muted-foreground">
              Aguardando primeira avaliação
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">2ª Avaliação Pendente</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.pending_second}</div>
            <p className="text-xs text-muted-foreground">
              Aguardando segunda avaliação
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completas</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.completed}</div>
            <p className="text-xs text-muted-foreground">
              Avaliações finalizadas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabelas */}
      <Tabs defaultValue="first" className="space-y-4">
        <TabsList>
          <TabsTrigger value="first">
            1ª Avaliação ({counts.pending_first})
          </TabsTrigger>
          <TabsTrigger value="second">
            2ª Avaliação ({counts.pending_second})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completas ({counts.completed})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="first">
          <Card>
            <CardHeader>
              <CardTitle>Aguardando 1ª Avaliação</CardTitle>
              <CardDescription>
                Ações que ainda não receberam nenhuma avaliação
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderTable(pendingFirst)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="second">
          <Card>
            <CardHeader>
              <CardTitle>Aguardando 2ª Avaliação</CardTitle>
              <CardDescription>
                Ações que já receberam a primeira avaliação
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderTable(pendingSecond, true)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed">
          <Card>
            <CardHeader>
              <CardTitle>Avaliações Completas</CardTitle>
              <CardDescription>
                Últimas 50 avaliações finalizadas
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderTable(completed, true)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
