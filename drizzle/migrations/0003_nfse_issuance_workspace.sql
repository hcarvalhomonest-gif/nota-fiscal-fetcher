CREATE TABLE public.issuance_settings (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL,
 municipality_code text NOT NULL CHECK (municipality_code ~ '^[0-9]{7}$'),
 municipal_registration text,
 tax_regime text NOT NULL CHECK (tax_regime IN ('mei','simples','normal')),
 special_tax_regime text NOT NULL DEFAULT '0' CHECK (special_tax_regime IN ('0','1','2','3','4','5','6','9')),
 simples_assessment text CHECK (simples_assessment IN ('1','2','3')),
 dps_series text NOT NULL DEFAULT '1' CHECK (dps_series ~ '^[0-9]{1,5}$'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.issuance_settings TO authenticated;
GRANT ALL ON public.issuance_settings TO service_role;
ALTER TABLE public.issuance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read accessible fiscal settings" ON public.issuance_settings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND (c.owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

CREATE TABLE public.nfse_issuances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 company_id uuid NOT NULL REFERENCES public.companies(id),
 certificate_id uuid REFERENCES public.certificates(id),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','processing','authorized','rejected','uncertain')),
 environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production','restricted')),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 fiscal_snapshot jsonb,
 dps_id text UNIQUE,
 dps_number bigint,
 access_key text,
 invoice_number text,
 xml_path text,
 pdf_path text,
 official_response jsonb,
 error_message text,
 confirmed_at timestamptz,
 sent_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1
);
GRANT SELECT ON public.nfse_issuances TO authenticated;
GRANT ALL ON public.nfse_issuances TO service_role;
ALTER TABLE public.nfse_issuances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read accessible issuances" ON public.nfse_issuances FOR SELECT TO authenticated USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE INDEX nfse_issuances_owner_created ON public.nfse_issuances(owner_id, created_at DESC);
CREATE INDEX nfse_issuances_queue ON public.nfse_issuances(status, created_at);
COMMENT ON TABLE public.nfse_issuances IS 'Issuance lifecycle is written exclusively by authenticated server endpoints; clients cannot authorize or queue fiscal documents directly.';