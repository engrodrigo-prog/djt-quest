import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle, XCircle, AlertCircle } from "lucide-react";
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

export function InitialUserImport() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{
    success: string[];
    errors: { name: string; error: string }[];
    admins: string[];
  } | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      const parsedUsers: UserRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length < 7) continue;
        
        parsedUsers.push({
          nome: values[0],
          matricula: values[1],
          email: values[2],
          telefone: values[3],
          cargo: values[4],
          sigla_area: values[5],
          base_operacional: values[6],
        });
      }

      setUsers(parsedUsers);
      toast.success(`${parsedUsers.length} usuários carregados do CSV`);
    } catch (error) {
      console.error('Error parsing CSV:', error);
      toast.error('Erro ao ler arquivo CSV');
    }
  };

  const handleImport = async () => {
    if (users.length === 0) {
      toast.error('Nenhum usuário para importar');
      return;
    }

    setImporting(true);
    setResults(null);

    try {
      const { data, error } = await supabase.functions.invoke('studio-import-initial-users', {
        body: { users },
      });

      if (error) throw error;

      setResults(data);
      
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importar Usuários Iniciais</CardTitle>
        <CardDescription>
          Faça upload do arquivo CSV com os dados dos usuários. Todos receberão a senha padrão "123456".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Formato esperado:</strong> Nome, Matrícula, Email, Telefone, Cargo, Sigla da Área, Base Operacional
          </AlertDescription>
        </Alert>

        <div className="flex gap-4">
          <label className="flex-1">
            <Button variant="outline" className="w-full" asChild>
              <span>
                <Upload className="mr-2 h-4 w-4" />
                Selecionar CSV
              </span>
            </Button>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          
          <Button 
            onClick={handleImport}
            disabled={users.length === 0 || importing}
            className="flex-1"
          >
            {importing ? 'Importando...' : `Importar ${users.length} Usuários`}
          </Button>
        </div>

        {results && (
          <div className="space-y-4 mt-6">
            {results.success.length > 0 && (
              <Alert className="border-green-500">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertDescription>
                  <strong className="text-green-600">Sucesso ({results.success.length}):</strong>
                  <ul className="mt-2 text-sm">
                    {results.success.slice(0, 5).map((name, i) => (
                      <li key={i}>✓ {name}</li>
                    ))}
                    {results.success.length > 5 && <li>... e mais {results.success.length - 5}</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {results.admins.length > 0 && (
              <Alert className="border-blue-500">
                <AlertCircle className="h-4 w-4 text-blue-500" />
                <AlertDescription>
                  <strong className="text-blue-600">Admins atribuídos:</strong> {results.admins.join(', ')}
                </AlertDescription>
              </Alert>
            )}

            {results.errors.length > 0 && (
              <Alert className="border-red-500">
                <XCircle className="h-4 w-4 text-red-500" />
                <AlertDescription>
                  <strong className="text-red-600">Erros ({results.errors.length}):</strong>
                  <ul className="mt-2 text-sm">
                    {results.errors.slice(0, 3).map((err, i) => (
                      <li key={i}>✗ {err.name}: {err.error}</li>
                    ))}
                    {results.errors.length > 3 && <li>... e mais {results.errors.length - 3}</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
