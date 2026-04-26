import { Link } from "react-router-dom";
import { ArrowRight, Building2, KeyRound, Download, ShieldCheck, Cpu, FileStack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-gradient-primary flex items-center justify-center font-display font-bold text-primary-foreground">
              N
            </div>
            <span className="font-display font-bold">NotaSync</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost">Entrar</Button></Link>
            <Link to="/auth"><Button>Começar</Button></Link>
          </div>
        </div>
      </header>

      <section className="bg-gradient-hero text-primary-foreground">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-foreground/10 text-xs font-medium tracking-wide uppercase mb-6">
              <ShieldCheck className="h-3.5 w-3.5" />
              Para o portal nacional NFS-e (gov.br)
            </div>
            <h1 className="font-display text-5xl md:text-6xl font-bold leading-[1.05] mb-6">
              Baixe XMLs e PDFs<br />de NFS-e em lote.
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/80 max-w-2xl mb-8">
              Cadastre suas empresas, faça upload do certificado A1 com senha, escolha um período
              e o NotaSync baixa todas as notas emitidas — sem clicar uma a uma.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/auth">
                <Button size="lg" variant="secondary" className="gap-2">
                  Criar conta grátis <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="font-display text-3xl font-bold mb-3">Como funciona</h2>
          <p className="text-muted-foreground mb-10 max-w-2xl">
            Quatro passos. Tudo automatizado pelo nosso worker que se autentica no portal nacional
            usando seu certificado A1.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Building2, title: "1. Empresas", text: "Cadastre o CNPJ e dados de cada empresa." },
              { icon: KeyRound, title: "2. Certificado A1", text: "Faça upload do .pfx e informe a senha. Tudo criptografado." },
              { icon: Cpu, title: "3. Download em lote", text: "Escolha período e dispare. O worker faz o trabalho pesado." },
              { icon: FileStack, title: "4. XML + PDF", text: "Baixe nota a nota ou tudo num ZIP único." },
            ].map(({ icon: Icon, title, text }) => (
              <Card key={title} className="p-6">
                <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-display font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/40 border-y border-border/60">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="font-display text-3xl font-bold mb-4">Segurança em primeiro lugar</h2>
            <ul className="space-y-3 text-muted-foreground">
              <li className="flex gap-2"><ShieldCheck className="h-5 w-5 text-success shrink-0" /> Senhas dos certificados criptografadas com AES-GCM no servidor.</li>
              <li className="flex gap-2"><ShieldCheck className="h-5 w-5 text-success shrink-0" /> Arquivos .pfx em bucket privado isolado por usuário.</li>
              <li className="flex gap-2"><ShieldCheck className="h-5 w-5 text-success shrink-0" /> Row-Level Security: cada usuário só vê suas próprias empresas.</li>
              <li className="flex gap-2"><ShieldCheck className="h-5 w-5 text-success shrink-0" /> Worker dedicado faz o mTLS no portal NFS-e Nacional.</li>
            </ul>
          </div>
          <Card className="p-6 shadow-elegant">
            <div className="flex items-center gap-3 mb-4">
              <Download className="h-5 w-5 text-primary" />
              <span className="font-display font-semibold">Lote típico</span>
            </div>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Período</span><span>01/03 → 31/03</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Notas encontradas</span><span>342</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">XMLs baixados</span><span className="text-success">342</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">PDFs (DANFSe)</span><span className="text-success">342</span></div>
              <div className="flex justify-between border-t pt-2 mt-2"><span className="text-muted-foreground">Tempo</span><span>~4 min</span></div>
            </div>
          </Card>
        </div>
      </section>

      <footer className="py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} NotaSync · Não é afiliado ao gov.br
      </footer>
    </div>
  );
};

export default Index;
