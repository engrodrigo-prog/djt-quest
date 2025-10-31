import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface UserRow {
  nome: string;
  matricula: string;
  email: string;
  telefone: string;
  cargo: string;
  sigla_area: string;
  base_operacional: string;
}

const INITIAL_USERS: UserRow[] = [
  {
    nome: "Rodrigo Henrique Alves do Nascimento",
    matricula: "601555",
    email: "rodrigonasc@cpfl.com.br",
    telefone: "19 996791908",
    cargo: "Gerente II",
    sigla_area: "DJT",
    base_operacional: "DJT"
  },
  {
    nome: "Cintia Veiga Claudio",
    matricula: "600001",
    email: "cveiga@cpfl.com.br",
    telefone: "",
    cargo: "Coordenação",
    sigla_area: "DJT-PLA",
    base_operacional: "Votorantim"
  },
  {
    nome: "Paulo Henrique Costa Camara",
    matricula: "600002",
    email: "paulo.camara@cpfl.com.br",
    telefone: "",
    cargo: "Gerente I",
    sigla_area: "DJTV",
    base_operacional: "Jundiaí"
  },
  {
    nome: "Rodrigo Carlos de Almeida",
    matricula: "600003",
    email: "rodrigo.almeida@cpfl.com.br",
    telefone: "",
    cargo: "Gerente I",
    sigla_area: "DJTB",
    base_operacional: "Santos"
  },
  {
    nome: "Sergio Dotto Dutra",
    matricula: "600004",
    email: "sergio.dutra@cpfl.com.br",
    telefone: "",
    cargo: "Coordenação",
    sigla_area: "DJTV-ITP",
    base_operacional: "Itapetininga"
  },
  {
    nome: "Osvaldo Ribeiro Martins Parreira",
    matricula: "600005",
    email: "osvaldo.parreira@cpfl.com.br",
    telefone: "",
    cargo: "Coordenação",
    sigla_area: "DJTV-VOT",
    base_operacional: "Votorantim"
  },
  {
    nome: "Rodrigo Marssola Garbelotti",
    matricula: "600006",
    email: "rodrigo.garbelotti@cpfl.com.br",
    telefone: "",
    cargo: "Coordenação",
    sigla_area: "DJTV-PJU",
    base_operacional: "Piraju"
  },
  {
    nome: "Lucas de Pauli Paglioni",
    matricula: "600007",
    email: "lucas.paglioni@cpfl.com.br",
    telefone: "",
    cargo: "Coordenação",
    sigla_area: "DJTV-JUN",
    base_operacional: "Jundiaí"
  },
  {
    nome: "Samuel Pereira Dias",
    matricula: "600008",
    email: "samuel.dias@cpfl.com.br",
    telefone: "",
    cargo: "Coordenação",
    sigla_area: "DJTB-CUB",
    base_operacional: "Cubatão"
  },
  {
    nome: "Bruno Eliton de Souza Silva",
    matricula: "600009",
    email: "bruno.silva@cpfl.com.br",
    telefone: "",
    cargo: "Coordenação",
    sigla_area: "DJTB-SAN",
    base_operacional: "Santos"
  }
];

const UserSetup = () => {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [importResults, setImportResults] = useState<{
    success: string[];
    errors: { name: string; error: string }[];
    admins: string[];
  } | null>(null);
  const [cleanupResults, setCleanupResults] = useState<{
    kept: string[];
    deleted: string[];
    errors: { email: string; error: string }[];
  } | null>(null);

  const handleImport = async () => {
    setImporting(true);
    setImportResults(null);

    try {
      const { data, error } = await supabase.functions.invoke('studio-import-initial-users', {
        body: { users: INITIAL_USERS },
      });

      if (error) throw error;

      setImportResults(data);
      
      if (data.success.length > 0) {
        toast.success(`${data.success.length} usuários importados com sucesso!`);
      }
      if (data.errors.length > 0) {
        toast.error(`${data.errors.length} erros durante importação`);
      }
    } catch (error) {
      console.error('Error importing users:', error);
      toast.error('Erro ao importar usuários');
    } finally {
      setImporting(false);
    }
  };

  const handleCleanup = async () => {
    if (!confirm(`Isso irá DELETAR todos os usuários EXCETO os ${INITIAL_USERS.length} usuários oficiais. Continuar?`)) {
      return;
    }

    setCleaning(true);
    setCleanupResults(null);

    try {
      const emailsToKeep = INITIAL_USERS.map(u => u.email.trim().toLowerCase());

      const { data, error } = await supabase.functions.invoke('studio-cleanup-users', {
        body: { emailsToKeep },
      });

      if (error) throw error;

      setCleanupResults(data);
      toast.success(`${data.deleted.length} usuários removidos, ${data.kept.length} mantidos`);
    } catch (error) {
      console.error('Error cleaning up users:', error);
      toast.error('Erro ao limpar usuários');
    } finally {
      setCleaning(false);
    }
  };

  const handleComplete = () => {
    toast.success('Setup completo! Redirecionando para o login...');
    setTimeout(() => navigate('/auth'), 1500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-djt-blue-dark to-djt-blue-medium p-6 flex items-center justify-center">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle className="text-2xl">Setup de Usuários - DJT Quest</CardTitle>
          <CardDescription>
            Configure os 10 usuários iniciais do sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Passo 1:</strong> Importar os {INITIAL_USERS.length} usuários oficiais<br />
              <strong>Passo 2:</strong> Limpar usuários de teste<br />
              <strong>Senha padrão:</strong> 123456 (deve ser alterada no primeiro login)
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 gap-4">
            <Button 
              onClick={handleImport}
              disabled={importing || !!importResults}
              size="lg"
              className="h-20"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Importando...
                </>
              ) : importResults ? (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" />
                  Importação Concluída
                </>
              ) : (
                `1. Importar ${INITIAL_USERS.length} Usuários`
              )}
            </Button>
            
            <Button 
              onClick={handleCleanup}
              disabled={cleaning || !importResults || !!cleanupResults}
              variant="destructive"
              size="lg"
              className="h-20"
            >
              {cleaning ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Limpando...
                </>
              ) : cleanupResults ? (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" />
                  Limpeza Concluída
                </>
              ) : (
                '2. Limpar Usuários de Teste'
              )}
            </Button>
          </div>

          {importResults && (
            <div className="space-y-3">
              <Alert className="border-green-500 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  <strong className="text-green-700">✅ {importResults.success.length} usuários criados</strong>
                  {importResults.admins.length > 0 && (
                    <p className="mt-1 text-sm">
                      👤 Admins: {importResults.admins.join(', ')}
                    </p>
                  )}
                </AlertDescription>
              </Alert>

              {importResults.errors.length > 0 && (
                <Alert className="border-red-500 bg-red-50">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription>
                    <strong className="text-red-700">❌ {importResults.errors.length} erros:</strong>
                    <ul className="mt-2 text-sm space-y-1">
                      {importResults.errors.map((err, i) => (
                        <li key={i}>{err.name}: {err.error}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {cleanupResults && (
            <div className="space-y-3">
              <Alert className="border-blue-500 bg-blue-50">
                <CheckCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription>
                  <strong className="text-blue-700">
                    ✅ {cleanupResults.kept.length} mantidos | 🗑️ {cleanupResults.deleted.length} removidos
                  </strong>
                </AlertDescription>
              </Alert>

              {cleanupResults.errors.length > 0 && (
                <Alert className="border-orange-500 bg-orange-50">
                  <XCircle className="h-4 w-4 text-orange-600" />
                  <AlertDescription>
                    <strong className="text-orange-700">⚠️ {cleanupResults.errors.length} erros na limpeza</strong>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {importResults && cleanupResults && (
            <Button 
              onClick={handleComplete}
              size="lg"
              className="w-full h-16 text-lg"
            >
              <CheckCircle className="mr-2 h-6 w-6" />
              Setup Completo - Ir para Login
            </Button>
          )}

          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm font-medium mb-2">Usuários que serão importados:</p>
            <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {INITIAL_USERS.map((user, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">#{i + 1}</span>
                  <span>{user.nome}</span>
                  <span className="text-muted-foreground">({user.cargo})</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UserSetup;
