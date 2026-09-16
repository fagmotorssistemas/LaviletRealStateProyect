const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
const {PGlite}=require('../tmp/integration-sql-tests/node_modules/@electric-sql/pglite')
test('reset preserves foreign keys, protects other leads and patch is repeatable',async()=>{
  const db=new PGlite()
  try{
    await db.exec(`CREATE TABLE financing_prequalifications(id integer primary key,lead_id integer);
      CREATE TABLE asesoria_financiamiento(id integer primary key,lead_id integer,prequalification_id integer references financing_prequalifications(id));
      INSERT INTO financing_prequalifications VALUES(1,2710090),(2,999);
      INSERT INTO asesoria_financiamiento VALUES(1,2710090,1),(2,999,2);
      CREATE FUNCTION lv_reset_lavilet_test_contact(p_kommo_id integer) RETURNS void LANGUAGE plpgsql AS $fn$
      DECLARE op record; backup jsonb;
      BEGIN
        IF p_kommo_id <> 2710090 THEN RAISE EXCEPTION 'Protected lead'; END IF;
        FOR op IN SELECT * FROM (VALUES
          ('financing_prequalifications','lead_id = $1'),
          ('asesoria_financiamiento','lead_id = $1')
        ) t(table_name,filter_sql) LOOP
          EXECUTE format('SELECT jsonb_agg(to_jsonb(t)) FROM %I t WHERE %s',op.table_name,op.filter_sql) INTO backup USING p_kommo_id;
        END LOOP;
        FOR op IN SELECT * FROM (VALUES
          ('financing_prequalifications','lead_id = $1'),
          ('asesoria_financiamiento','lead_id = $1')
        ) t(table_name,filter_sql) LOOP
          EXECUTE format('DELETE FROM %I WHERE %s',op.table_name,op.filter_sql) USING p_kommo_id;
        END LOOP;
      END $fn$;`)
    await assert.rejects(db.query('SELECT lv_reset_lavilet_test_contact(2710090)'),e=>e.code==='23503')
    const patch=fs.readFileSync('supabase/migrations/20260916210000_reset_financing_dependency_order.sql','utf8')
    assert.equal(patch,fs.readFileSync('operations/corregir_reinicio_financiamiento.sql','utf8'))
    await db.exec(patch);await db.exec(patch)
    assert.equal((await db.query('SELECT count(*)::int n FROM financing_prequalifications')).rows[0].n,2,'installation does not reset leads')
    await assert.rejects(db.query('SELECT lv_reset_lavilet_test_contact(999)'),/Protected lead/)
    await db.query('SELECT lv_reset_lavilet_test_contact(2710090)')
    for(const table of ['asesoria_financiamiento','financing_prequalifications'])assert.deepEqual((await db.query('SELECT lead_id FROM '+table)).rows,[{lead_id:999}])
    const definition=(await db.query("SELECT pg_get_functiondef('lv_reset_lavilet_test_contact(integer)'::regprocedure) d")).rows[0].d
    await db.exec(definition.replaceAll("'lead_id = $1'","'lead_id=$1'"))
    await assert.rejects(db.exec(patch),/no se modifico/)
    await db.exec('ROLLBACK')
  }finally{await db.close()}
})
