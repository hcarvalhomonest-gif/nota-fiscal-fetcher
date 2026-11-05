ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS is_procurador boolean NOT NULL DEFAULT false;
ALTER TABLE public.certificates ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.download_jobs ADD COLUMN IF NOT EXISTS fallback_certificate_id uuid REFERENCES public.certificates(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'emitida';
UPDATE public.invoices i SET tipo = 'tomada'
FROM public.download_jobs j JOIN public.companies c ON c.id = j.company_id
WHERE i.job_id = j.id AND i.prestador_cnpj IS NOT NULL
  AND regexp_replace(i.prestador_cnpj, '\D', '', 'g') <> regexp_replace(c.cnpj, '\D', '', 'g');
CREATE INDEX IF NOT EXISTS invoices_tipo_idx ON public.invoices(tipo);