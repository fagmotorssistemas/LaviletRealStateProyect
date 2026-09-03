-- ============================================================
-- Seed: tour demo — matriz completa (idempotente via upsert)
--
-- 3 ambientes × 2 acabados × 2 luces = 12 panoramas
-- + 1 balcón (finish_package_id NULL) × 2 luces = 2 panoramas
-- + 2 finish_packages + 6 transiciones
--
-- Prerequisito: unit_types con slug = 'tipo_a' debe existir.
-- Idempotencia: UUIDs determinísticos + ON CONFLICT (id) DO UPDATE.
-- Cero DELETE. Re-ejecutar actualiza las filas existentes.
-- ============================================================

DO $$
DECLARE
  -- Namespace fijo para uuid_generate_v5 (RFC 4122 DNS namespace)
  v_ns         uuid := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

  v_tenant     uuid;
  v_project    uuid;
  v_ut         uuid;

  v_fp_nogal   uuid;
  v_fp_roble   uuid;

  -- Hotspots por ambiente
  v_hs_sala       jsonb := jsonb_build_array(
    jsonb_build_object('id','sala-to-cocina',     'type','link','yaw', 1.57,'pitch',0,'tooltip','Ir a cocina',     'target_room','cocina'),
    jsonb_build_object('id','sala-to-dormitorio', 'type','link','yaw',-1.57,'pitch',0,'tooltip','Ir a dormitorio', 'target_room','dormitorio'),
    jsonb_build_object('id','sala-to-balcon',     'type','link','yaw', 3.14,'pitch',0,'tooltip','Ir al balcón',    'target_room','balcon'),
    jsonb_build_object('id','sala-info-1',        'type','info','yaw', 0.5, 'pitch',0.2,'tooltip','Ventanales doble altura')
  );
  v_hs_cocina     jsonb := jsonb_build_array(
    jsonb_build_object('id','cocina-to-sala','type','link','yaw', 3.14,'pitch',0,'tooltip','Ir a sala','target_room','sala')
  );
  v_hs_dormitorio jsonb := jsonb_build_array(
    jsonb_build_object('id','dormitorio-to-sala','type','link','yaw', 0,'pitch',0,'tooltip','Ir a sala','target_room','sala')
  );
  v_hs_balcon     jsonb := jsonb_build_array(
    jsonb_build_object('id','balcon-to-sala','type','link','yaw', 0,'pitch',0,'tooltip','Volver a sala','target_room','sala')
  );

  v_fin  text;
  v_fp   uuid;
  v_luz  text;
  v_room text;
  v_hs   jsonb;
  v_mx   numeric;
  v_my   numeric;
  v_mh   numeric;
  v_iyaw numeric;
  v_sort int;
  v_id   uuid;
BEGIN

  -- ── Resolver unit_type ────────────────────────────────────
  SELECT ut.tenant_id, ut.project_id, ut.id
    INTO v_tenant, v_project, v_ut
    FROM unit_types ut
   WHERE ut.slug = 'tipo_a'
   LIMIT 1;

  IF v_ut IS NULL THEN
    RAISE EXCEPTION 'No existe unit_type con slug = tipo_a';
  END IF;

  -- UUIDs determinísticos para finish_packages
  v_fp_nogal := extensions.uuid_generate_v5(v_ns, 'tour-seed:finish:nogal');
  v_fp_roble := extensions.uuid_generate_v5(v_ns, 'tour-seed:finish:roble');

  -- ── finish_packages (upsert) ──────────────────────────────
  INSERT INTO finish_packages (id, tenant_id, project_id, name, slug, is_default, sort_order)
  VALUES
    (v_fp_nogal, v_tenant, v_project, 'Nogal', 'nogal', true,  0),
    (v_fp_roble, v_tenant, v_project, 'Roble', 'roble', false, 1)
  ON CONFLICT (id) DO UPDATE SET
    name       = EXCLUDED.name,
    slug       = EXCLUDED.slug,
    is_default = EXCLUDED.is_default,
    sort_order = EXCLUDED.sort_order;

  -- ── tour_panoramas: 3 rooms × 2 acabados × 2 luces ───────
  FOREACH v_fin IN ARRAY ARRAY['nogal','roble'] LOOP
    v_fp := CASE v_fin WHEN 'nogal' THEN v_fp_nogal ELSE v_fp_roble END;

    FOREACH v_luz IN ARRAY ARRAY['dia','noche'] LOOP
      v_sort := 0;

      FOREACH v_room IN ARRAY ARRAY['sala','cocina','dormitorio'] LOOP

        v_hs := CASE v_room
                  WHEN 'sala'       THEN v_hs_sala
                  WHEN 'cocina'     THEN v_hs_cocina
                  WHEN 'dormitorio' THEN v_hs_dormitorio
                END;

        v_mx   := CASE v_room WHEN 'sala' THEN 50 WHEN 'cocina' THEN 50 WHEN 'dormitorio' THEN 80 END;
        v_my   := CASE v_room WHEN 'sala' THEN 50 WHEN 'cocina' THEN 20 WHEN 'dormitorio' THEN 60 END;
        v_mh   := CASE v_room WHEN 'sala' THEN 0  WHEN 'cocina' THEN 180 WHEN 'dormitorio' THEN 270 END;
        v_iyaw := CASE v_room WHEN 'sala' THEN 0  WHEN 'cocina' THEN 1.57 WHEN 'dormitorio' THEN -1.57 END;

        v_id := extensions.uuid_generate_v5(v_ns, format('tour-seed:pano:%s:%s:%s', v_room, v_fin, v_luz));

        INSERT INTO tour_panoramas (
          id, tenant_id, unit_type_id, room, room_label,
          finish_package_id, light, url,
          variants,
          initial_yaw, initial_pitch,
          map_x, map_y, map_heading,
          hotspots, sort_order, is_published
        ) VALUES (
          v_id, v_tenant, v_ut,
          v_room, initcap(v_room),
          v_fp, v_luz,
          format('/tours/demo/tipo_a_%s_%s_%s.jpg', v_room, v_fin, v_luz),
          jsonb_build_object(
            '4096', jsonb_build_object('url', format('/tours/demo/tipo_a_%s_%s_%s_4096.webp', v_room, v_fin, v_luz)),
            '2048', jsonb_build_object('url', format('/tours/demo/tipo_a_%s_%s_%s_2048.webp', v_room, v_fin, v_luz))
          ),
          v_iyaw, 0,
          v_mx, v_my, v_mh,
          v_hs, v_sort, true
        )
        ON CONFLICT (id) DO UPDATE SET
          room_label        = EXCLUDED.room_label,
          finish_package_id = EXCLUDED.finish_package_id,
          light             = EXCLUDED.light,
          url               = EXCLUDED.url,
          variants          = EXCLUDED.variants,
          initial_yaw       = EXCLUDED.initial_yaw,
          initial_pitch     = EXCLUDED.initial_pitch,
          map_x             = EXCLUDED.map_x,
          map_y             = EXCLUDED.map_y,
          map_heading       = EXCLUDED.map_heading,
          hotspots          = EXCLUDED.hotspots,
          sort_order        = EXCLUDED.sort_order,
          is_published      = EXCLUDED.is_published;

        v_sort := v_sort + 1;
      END LOOP; -- room
    END LOOP; -- luz
  END LOOP; -- acabado

  -- ── tour_panoramas: balcón (finish_package_id NULL) ───────
  FOREACH v_luz IN ARRAY ARRAY['dia','noche'] LOOP

    v_id := extensions.uuid_generate_v5(v_ns, format('tour-seed:pano:balcon:null:%s', v_luz));

    INSERT INTO tour_panoramas (
      id, tenant_id, unit_type_id, room, room_label,
      finish_package_id, light, url,
      variants,
      initial_yaw, initial_pitch,
      map_x, map_y, map_heading,
      hotspots, sort_order, is_published
    ) VALUES (
      v_id, v_tenant, v_ut,
      'balcon', 'Balcón',
      NULL, v_luz,
      format('/tours/demo/tipo_a_balcon_%s.jpg', v_luz),
      jsonb_build_object(
        '4096', jsonb_build_object('url', format('/tours/demo/tipo_a_balcon_%s_4096.webp', v_luz)),
        '2048', jsonb_build_object('url', format('/tours/demo/tipo_a_balcon_%s_2048.webp', v_luz))
      ),
      3.14, 0,
      20, 50, 90,
      v_hs_balcon, 3, true
    )
    ON CONFLICT (id) DO UPDATE SET
      room_label        = EXCLUDED.room_label,
      finish_package_id = EXCLUDED.finish_package_id,
      light             = EXCLUDED.light,
      url               = EXCLUDED.url,
      variants          = EXCLUDED.variants,
      initial_yaw       = EXCLUDED.initial_yaw,
      initial_pitch     = EXCLUDED.initial_pitch,
      map_x             = EXCLUDED.map_x,
      map_y             = EXCLUDED.map_y,
      map_heading       = EXCLUDED.map_heading,
      hotspots          = EXCLUDED.hotspots,
      sort_order        = EXCLUDED.sort_order,
      is_published      = EXCLUDED.is_published;

  END LOOP;

  -- ── tour_transitions (3 pares bidireccionales = 6 filas) ──
  INSERT INTO tour_transitions (id, tenant_id, unit_type_id, from_room, to_room, video_url, duration_ms)
  VALUES
    (extensions.uuid_generate_v5(v_ns, 'tour-seed:tr:sala:cocina'),      v_tenant, v_ut, 'sala',       'cocina',     '/tours/demo/transitions/sala_cocina.mp4',      1500),
    (extensions.uuid_generate_v5(v_ns, 'tour-seed:tr:cocina:sala'),      v_tenant, v_ut, 'cocina',     'sala',       '/tours/demo/transitions/cocina_sala.mp4',      1500),
    (extensions.uuid_generate_v5(v_ns, 'tour-seed:tr:sala:dormitorio'),  v_tenant, v_ut, 'sala',       'dormitorio', '/tours/demo/transitions/sala_dormitorio.mp4',  2000),
    (extensions.uuid_generate_v5(v_ns, 'tour-seed:tr:dormitorio:sala'),  v_tenant, v_ut, 'dormitorio', 'sala',       '/tours/demo/transitions/dormitorio_sala.mp4',  2000),
    (extensions.uuid_generate_v5(v_ns, 'tour-seed:tr:sala:balcon'),      v_tenant, v_ut, 'sala',       'balcon',     '/tours/demo/transitions/sala_balcon.mp4',      1200),
    (extensions.uuid_generate_v5(v_ns, 'tour-seed:tr:balcon:sala'),      v_tenant, v_ut, 'balcon',     'sala',       '/tours/demo/transitions/balcon_sala.mp4',      1200)
  ON CONFLICT (id) DO UPDATE SET
    from_room   = EXCLUDED.from_room,
    to_room     = EXCLUDED.to_room,
    video_url   = EXCLUDED.video_url,
    duration_ms = EXCLUDED.duration_ms;

END $$;
