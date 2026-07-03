ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS prestador_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS prestador_razao TEXT,
  ADD COLUMN IF NOT EXISTS valor_servicos NUMERIC;