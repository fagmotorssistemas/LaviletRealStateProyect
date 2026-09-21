-- FK para embeds PostgREST y permitir contado sin partner
UPDATE public.lead_financing lf
SET financing_partner_id = NULL
WHERE financing_partner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.financing_partners p WHERE p.id = lf.financing_partner_id
  );

ALTER TABLE public.lead_financing
  DROP CONSTRAINT IF EXISTS lead_financing_financing_partner_id_fkey;

ALTER TABLE public.lead_financing
  ADD CONSTRAINT lead_financing_financing_partner_id_fkey
  FOREIGN KEY (financing_partner_id)
  REFERENCES public.financing_partners (id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lead_financing_financing_partner_id_idx
  ON public.lead_financing (financing_partner_id);

-- RLS: la tabla tenía RLS sin políticas (bloqueaba al cliente de sesión)
DROP POLICY IF EXISTS "Authenticated read lead_financing" ON public.lead_financing;
DROP POLICY IF EXISTS "Authenticated all lead_financing" ON public.lead_financing;

CREATE POLICY "Authenticated read lead_financing"
  ON public.lead_financing
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated all lead_financing"
  ON public.lead_financing
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON CONSTRAINT lead_financing_financing_partner_id_fkey ON public.lead_financing IS
  'Embed PostgREST: financing_partners; nullable para compra al contado';
