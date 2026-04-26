
-- Enum de papéis
create type public.app_role as enum ('admin', 'user');

-- Enum de status de job
create type public.job_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- =========================================================
-- PROFILES
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- =========================================================
-- USER ROLES
-- =========================================================
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- =========================================================
-- COMPANIES
-- =========================================================
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  cnpj text not null,
  legal_name text not null,
  trade_name text,
  municipality text,
  state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_owner_idx on public.companies(owner_id);
alter table public.companies enable row level security;

-- =========================================================
-- CERTIFICATES
-- =========================================================
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,            -- caminho dentro do bucket privado 'certificates'
  password_encrypted text not null,      -- senha criptografada via edge function
  password_iv text not null,             -- IV usado na criptografia
  subject_name text,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index certificates_company_idx on public.certificates(company_id);
create index certificates_owner_idx on public.certificates(owner_id);
alter table public.certificates enable row level security;

-- =========================================================
-- DOWNLOAD JOBS
-- =========================================================
create table public.download_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  certificate_id uuid not null references public.certificates(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status public.job_status not null default 'pending',
  total_invoices integer not null default 0,
  downloaded_invoices integer not null default 0,
  error_message text,
  worker_token text,                     -- token usado pelo worker para autenticar callbacks
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index download_jobs_owner_idx on public.download_jobs(owner_id);
create index download_jobs_status_idx on public.download_jobs(status);
alter table public.download_jobs enable row level security;

-- =========================================================
-- INVOICES
-- =========================================================
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.download_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  chave_acesso text,
  numero text,
  serie text,
  data_emissao timestamptz,
  tomador_nome text,
  tomador_documento text,
  valor_total numeric(15,2),
  xml_path text,                         -- bucket 'invoices'
  pdf_path text,                         -- bucket 'invoices'
  created_at timestamptz not null default now()
);
create index invoices_job_idx on public.invoices(job_id);
create index invoices_owner_idx on public.invoices(owner_id);
create unique index invoices_chave_unique on public.invoices(job_id, chave_acesso) where chave_acesso is not null;
alter table public.invoices enable row level security;

-- =========================================================
-- updated_at trigger helper
-- =========================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.tg_set_updated_at();

-- =========================================================
-- Auto-create profile + default role on signup
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- profiles
create policy "users view own profile" on public.profiles
  for select to authenticated using (auth.uid() = id or public.has_role(auth.uid(), 'admin'));
create policy "users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- user_roles (read only for the user themselves, admins see all; only admins write)
create policy "users see own roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage roles" on public.user_roles
  for all to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- companies
create policy "owner or admin select companies" on public.companies
  for select to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "owner insert companies" on public.companies
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owner update companies" on public.companies
  for update to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "owner delete companies" on public.companies
  for delete to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- certificates
create policy "owner or admin select certificates" on public.certificates
  for select to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "owner insert certificates" on public.certificates
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owner update certificates" on public.certificates
  for update to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "owner delete certificates" on public.certificates
  for delete to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- download_jobs
create policy "owner or admin select jobs" on public.download_jobs
  for select to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "owner insert jobs" on public.download_jobs
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owner update jobs" on public.download_jobs
  for update to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "owner delete jobs" on public.download_jobs
  for delete to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- invoices
create policy "owner or admin select invoices" on public.invoices
  for select to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "owner insert invoices" on public.invoices
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owner delete invoices" on public.invoices
  for delete to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- STORAGE BUCKETS (private)
-- =========================================================
insert into storage.buckets (id, name, public) values
  ('certificates', 'certificates', false),
  ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- Storage policies: users can read/write only files inside a folder named with their user id
create policy "users read own certificates" on storage.objects
  for select to authenticated
  using (bucket_id = 'certificates' and (auth.uid()::text = (storage.foldername(name))[1] or public.has_role(auth.uid(), 'admin')));

create policy "users upload own certificates" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'certificates' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "users update own certificates" on storage.objects
  for update to authenticated
  using (bucket_id = 'certificates' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "users delete own certificates" on storage.objects
  for delete to authenticated
  using (bucket_id = 'certificates' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "users read own invoices" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and (auth.uid()::text = (storage.foldername(name))[1] or public.has_role(auth.uid(), 'admin')));

create policy "users upload own invoices" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "users delete own invoices" on storage.objects
  for delete to authenticated
  using (bucket_id = 'invoices' and auth.uid()::text = (storage.foldername(name))[1]);
