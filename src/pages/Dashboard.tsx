import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, KeyRound, FileDown, FileStack, ArrowRight, AlertTriangle } from "lucide-react";

const Dashboard = () => {
  const [counts, setCounts] = useState({ companies: 0, certs: 0, jobs: 0, invoices: 0 });
  const [pending, setPending] = useState(0);

  useEffect(() => {
    (async () => {
      const [c, k, j, i, p] = await Promise.all([
        supabase.from("companies").select("*", { count: "exact", head: true }),
        supabase.from("certificates").select("*", { count: "exact", head: true }),
        supabase.from("download_jobs").select("*", { count: "exact", head: true }),
        supabase.from("invoices").select("*", { count: "exact", head: true }),
        supabase.from("download_jobs").select("*", { count: "exact", head: true }).in("status", ["pending", "processing"]),
      ]);
      setCounts({
        companies: c.count ?? 0, certs: k.count ?? 0, jobs: j.count ?? 0, invoices: i.count ?? 0,
      });
      setPending(p.count ?? 0);
    })();
  }, []);

  const cards = [
    { label: "Empresas", value: counts.companies, icon: Building2, to: "/app/empresas" },
    { label: "Certificados", value: counts.certs, icon: KeyRound, to: "/app/certificados" },
    { label: "Downloads", value: counts.jobs, icon: FileDown, to: "/app/jobs" },
    { label: "Notas baixadas", value: counts.invoices, icon: FileStack, to: "/app/notas" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold mb-1">Painel</h1>
        <p className="text-muted-foreground">Visão geral das suas empresas e downloads.</p>
      </div>

      {pending > 0 && (
        <Card className="p-4 bg-warning/10 border-warning/30 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{pending} job(s) na fila</div>
            <div className="text-sm text-muted-foreground">
              O worker externo precisa estar rodando para processar. Veja em Downloads.
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, to }) => (
          <Link key={label} to={to}>
            <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center justify-between mb-3">
                <Icon className="h-5 w-5 text-primary" />
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-3xl font-display font-bold">{value}</div>
              <div className="text-sm text-muted-foreground">{label}</div>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="font-display font-semibold mb-2">Próximos passos</h2>
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
          <li>Cadastre uma <Link to="/app/empresas" className="text-primary underline">empresa</Link>.</li>
          <li>Faça upload do <Link to="/app/certificados" className="text-primary underline">certificado A1</Link> dela.</li>
          <li>Crie um <Link to="/app/jobs" className="text-primary underline">job de download</Link> definindo o período.</li>
          <li>Mantenha o <strong>worker</strong> rodando na sua VPS — código no README.</li>
        </ol>
      </Card>
    </div>
  );
};

export default Dashboard;
