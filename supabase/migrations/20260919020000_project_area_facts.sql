-- Contexto comercial positivo del sector de cada proyecto.
-- Esta tabla es independiente: no altera proyectos, lugares cercanos, instalaciones
-- ni reglas de automatización existentes. Sus filas nacen como borrador y el bot
-- solo puede consumirlas después de una aprobación explícita en otra migración.

CREATE TABLE IF NOT EXISTS public.project_area_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  fact_key text NOT NULL CHECK (fact_key ~ '^[a-z0-9_]{3,80}$'),
  category text NOT NULL CHECK (category IN (
    'sector_positioning',
    'commercial_activity',
    'nearby_services',
    'quality_of_life',
    'urban_connectivity',
    'investment_positioning'
  )),
  headline text NOT NULL CHECK (length(btrim(headline)) BETWEEN 3 AND 120),
  fact_text text NOT NULL CHECK (length(btrim(fact_text)) BETWEEN 10 AND 1200),
  safe_sales_text text NOT NULL CHECK (length(btrim(safe_sales_text)) BETWEEN 10 AND 700),
  audiences text[] NOT NULL DEFAULT ARRAY['residential','commercial','investment']::text[],
  commercial_modes text[] NOT NULL DEFAULT ARRAY['lanzamiento','preventa','venta']::text[],
  source_name text,
  source_url text CHECK (source_url IS NULL OR source_url ~ '^https://'),
  verified_on date,
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','verified','archived')),
  approved_for_bot boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(audiences) > 0 AND audiences <@ ARRAY['residential','commercial','investment']::text[]),
  CHECK (cardinality(commercial_modes) > 0 AND commercial_modes <@ ARRAY['lanzamiento','preventa','venta']::text[]),
  CHECK (review_status = 'verified' OR approved_for_bot = false),
  UNIQUE (project_id, fact_key)
);

CREATE INDEX IF NOT EXISTS project_area_facts_project_active
  ON public.project_area_facts(project_id, category, approved_for_bot)
  WHERE review_status <> 'archived';

ALTER TABLE public.project_area_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_area_facts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_area_facts TO service_role;

COMMENT ON TABLE public.project_area_facts IS
  'Hechos y argumentos positivos sobre el sector del proyecto, con fuente, revisión y autorización explícita antes de usarlos en respuestas del bot.';
COMMENT ON COLUMN public.project_area_facts.fact_text IS
  'Descripción interna completa del hecho aportado o investigado.';
COMMENT ON COLUMN public.project_area_facts.safe_sales_text IS
  'Redacción comercial prudente: no garantiza tránsito, demanda, plusvalía ni rentabilidad.';
COMMENT ON COLUMN public.project_area_facts.approved_for_bot IS
  'Solo una fila verificada puede aprobarse. El contexto comercial lee exclusivamente filas aprobadas.';

INSERT INTO public.project_area_facts (
  tenant_id,
  project_id,
  fact_key,
  category,
  headline,
  fact_text,
  safe_sales_text,
  audiences,
  commercial_modes,
  source_name,
  review_status,
  approved_for_bot
)
SELECT
  p.tenant_id,
  p.id,
  seed.fact_key,
  seed.category,
  seed.headline,
  seed.fact_text,
  seed.safe_sales_text,
  seed.audiences,
  ARRAY['lanzamiento','preventa','venta']::text[],
  'Información aportada por el responsable del proyecto el 19 de septiembre de 2026',
  'draft',
  false
FROM public.projects p
CROSS JOIN (VALUES
  (
    'puertas_del_sol_posicionamiento',
    'sector_positioning',
    'Sector residencial y comercial consolidado',
    'Puertas del Sol es presentado como un sector consolidado de Cuenca que combina vida residencial, actividad comercial y servicios.',
    'Puertas del Sol combina un entorno residencial consolidado con actividad comercial y servicios cercanos.',
    ARRAY['residential','commercial','investment']::text[]
  ),
  (
    'puertas_del_sol_plazas_comerciales',
    'commercial_activity',
    'Plazas y oferta comercial en el sector',
    'El sector cuenta con plazas comerciales y una oferta variada de establecimientos de comida, farmacias, cafeterías, tiendas y servicios.',
    'En el sector existen plazas comerciales y una oferta variada de establecimientos y servicios que complementan la actividad residencial.',
    ARRAY['commercial','residential','investment']::text[]
  ),
  (
    'puertas_del_sol_servicios_cercanos',
    'nearby_services',
    'Servicios cotidianos cercanos',
    'En el entorno de Puertas del Sol se encuentran bancos, supermercados, cafeterías y otros servicios de uso cotidiano.',
    'La ubicación permite acceder a bancos, supermercados, cafeterías y otros servicios presentes en el sector.',
    ARRAY['residential','commercial','investment']::text[]
  ),
  (
    'puertas_del_sol_entorno_tomebamba',
    'quality_of_life',
    'Cercanía al río Tomebamba y áreas verdes',
    'La cercanía al río Tomebamba y a sus áreas verdes aporta espacios para caminar, practicar actividades recreativas y disfrutar del entorno.',
    'La cercanía al río Tomebamba y a sus áreas verdes complementa la vida urbana con espacios de recreación y paseo.',
    ARRAY['residential','investment']::text[]
  ),
  (
    'puertas_del_sol_oferta_deportiva',
    'quality_of_life',
    'Infraestructura deportiva en el entorno',
    'El sector incorpora espacios e infraestructura para actividades deportivas, recreación y encuentro de sus residentes y visitantes.',
    'El entorno cuenta con espacios deportivos y recreativos que amplían las alternativas disponibles en el sector.',
    ARRAY['residential','investment']::text[]
  ),
  (
    'puertas_del_sol_conectividad',
    'urban_connectivity',
    'Conexión con ejes urbanos de Cuenca',
    'La cercanía a la avenida Ordóñez Lasso conecta Puertas del Sol con un eje urbano importante de Cuenca.',
    'Puertas del Sol se conecta con la avenida Ordóñez Lasso, uno de los ejes urbanos relevantes de Cuenca.',
    ARRAY['residential','commercial','investment']::text[]
  ),
  (
    'puertas_del_sol_desarrollo_inmobiliario',
    'investment_positioning',
    'Desarrollo inmobiliario del sector',
    'Puertas del Sol ha concentrado interés para el desarrollo de edificios contemporáneos de departamentos, suites y espacios comerciales.',
    'El desarrollo de nuevos proyectos residenciales y comerciales forma parte de la evolución urbana de Puertas del Sol.',
    ARRAY['investment','commercial','residential']::text[]
  ),
  (
    'puertas_del_sol_potencial_valorizacion',
    'investment_positioning',
    'Atractivo para inversión inmobiliaria',
    'La consolidación residencial, la presencia de servicios y el desarrollo inmobiliario hacen que la ubicación sea considerada atractiva al evaluar una inversión.',
    'La consolidación del sector y su desarrollo inmobiliario hacen que la ubicación sea un aspecto relevante al evaluar una inversión, sin garantizar una valorización futura.',
    ARRAY['investment','commercial','residential']::text[]
  )
) AS seed(fact_key, category, headline, fact_text, safe_sales_text, audiences)
WHERE p.id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND p.tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
ON CONFLICT (project_id, fact_key) DO NOTHING;
