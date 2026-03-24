-- Módulo de proyectos: campos descriptivos + tabla project_assets + bucket project-assets
-- (Aplicada en remoto; mantener sincronizado con Supabase.)

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'Ecuador',
  ADD COLUMN IF NOT EXISTS developer_name text,
  ADD COLUMN IF NOT EXISTS construction_phase text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS total_units_planned integer;

DO $$
BEGIN
  ALTER TABLE public.projects
    ADD CONSTRAINT projects_construction_phase_check
    CHECK (
      construction_phase IS NULL
      OR construction_phase IN ('preventa', 'en_construccion', 'entrega_proxima', 'entregado')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.project_assets (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  is_cover boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT project_assets_pkey PRIMARY KEY (id),
  CONSTRAINT project_assets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT project_assets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE CASCADE,
  CONSTRAINT project_assets_kind_check CHECK (
    kind = ANY (ARRAY['photo'::text, 'floor_plan'::text, 'brochure'::text, 'document'::text, 'other'::text])
  )
);

CREATE INDEX IF NOT EXISTS project_assets_project_id_idx ON public.project_assets USING btree (project_id);
CREATE INDEX IF NOT EXISTS project_assets_tenant_id_idx ON public.project_assets USING btree (tenant_id);

DROP TRIGGER IF EXISTS update_project_assets_updated_at ON public.project_assets;
CREATE TRIGGER update_project_assets_updated_at
  BEFORE UPDATE ON public.project_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated all project_assets" ON public.project_assets;
CREATE POLICY "Authenticated all project_assets"
  ON public.project_assets
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-assets', 'project-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "project-assets: authenticated select" ON storage.objects;
DROP POLICY IF EXISTS "project-assets: authenticated insert" ON storage.objects;
DROP POLICY IF EXISTS "project-assets: authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "project-assets: authenticated delete" ON storage.objects;

CREATE POLICY "project-assets: authenticated select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-assets');

CREATE POLICY "project-assets: authenticated insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-assets');

CREATE POLICY "project-assets: authenticated update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-assets')
  WITH CHECK (bucket_id = 'project-assets');

CREATE POLICY "project-assets: authenticated delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-assets');
