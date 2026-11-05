ALTER TABLE public.download_jobs ADD COLUMN invoice_type text NOT NULL DEFAULT 'ambas' CHECK (invoice_type IN ('emitida', 'tomada', 'ambas'));
ALTER TABLE public.invoices ADD COLUMN cancelada boolean DEFAULT NULL;
COMMENT ON COLUMN public.invoices.cancelada IS 'NULL means cancellation status has not been reported; true cancelled, false active.';