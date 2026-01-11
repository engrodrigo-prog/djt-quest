import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizePhone } from "@/lib/phone";
import { toast } from "sonner";

export function PhoneConfirmation() {
  const { profile, refreshUserSession } = useAuth();
  const initial = useMemo(() => String(profile?.phone || "").trim(), [profile?.phone]);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const normalized = useMemo(() => normalizePhone(value), [value]);
  const error = touched && !normalized ? "Formato inválido. Use DDI +XX, DDD XX e número XXXXX-XXXX." : null;

  const onConfirm = async () => {
    setTouched(true);
    if (!normalized) return;
    setSaving(true);
    try {
      const res = await supabase.functions.invoke("update-phone", { body: { phone: normalized } });
      if (res.error) {
        const txt = await res.response?.text().catch(() => "");
        throw new Error(txt || res.error.message);
      }
      toast.success("Telefone confirmado!");
      await refreshUserSession();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao confirmar telefone");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Confirme seu WhatsApp</CardTitle>
          <CardDescription>
            No próximo login, precisamos confirmar seu número para facilitar o contato. Ajuste se necessário e confirme.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone (WhatsApp)</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="+55 11 91234-5678"
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {!error && normalized ? <p className="text-xs text-muted-foreground">Salvaremos como: {normalized}</p> : null}
          </div>

          <Button className="w-full" onClick={onConfirm} disabled={saving || !normalized}>
            {saving ? "Confirmando..." : "Confirmar e continuar"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

