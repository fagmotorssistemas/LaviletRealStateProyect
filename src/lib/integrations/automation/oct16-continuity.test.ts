import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTurnSemantics } from './turn-semantics';
import { resolvePropertyTurn } from './property-context';
import { commercialJourneyPlan } from './commercial-journey';
import { selectedUnitModelDelivery } from './unit-model';
import { replyLinkContract } from './response-plan';
import { taskModelEvidence } from './task-context';
import { leadIntroductionTurn } from './lead-introduction';
import { object, type Row } from './data';
import { contactDisplayName } from '@/lib/inmobiliaria/contactDisplayName';
import { observedShowroomUnit, showroomButtonReply,showroomInvitationBody } from '@/lib/tour/showroomInterest';
import { approvedShowroomTemplate } from './kommo';
import { showWhatsAppTyping } from './whatsapp-typing';
import {advisorAttentionPriority,advisorAttentionPriorityReason} from '@/lib/inmobiliaria/advisorAttention';
const unit: Row = { id: '2d79387f-a27f-46e8-9ad2-afeb70adc37b', unit_number: '605', category: 'penthouse', is_published: true, status: 'disponible', bedrooms: 3, bathrooms_full: 3, area_internal_m2: 140.53, published_commercial_price: 337272, floor_number: 6 };
const previous: Row = { _property_context: { version: 2, query: { category: 'penthouse', group: 'residential', scope: 'comparison', operation: 'compare', filters: { bedrooms: 3 } }, offered_ids: [unit.id], selected_ids: [], focused_ids: [unit.id], exploration_state: { authorized: true, evidence: 'exploremos esas opciones', accepted_filters: { bedrooms: 3 } } } };
test('category choice with price preserves the accepted search and presents both penthouses with features',()=>{
 const second={...unit,id:'38096796-5f64-4022-9cf6-8549626647f1',unit_number:'602',bathrooms_full:2,area_internal_m2:142.09,published_commercial_price:341016};
 const current='me quedo con los penthouses porque son más espaciosos\ny qué precio tienen?';
 const meaning=normalizeTurnSemantics({turn_semantics:{primary_intent:'ask_price',primary_evidence:'y qué precio tienen?',confidence:'high',
   property:{group:'residential',category:'penthouse',operation:'details',reference_kind:'followup',query_scope:'offered',unit_numbers:[],filters:{},evidence:'y qué precio tienen?',confidence:'high'},
   category_choice:{kind:'selected',category:'penthouse',evidence:'me quedo con los penthouses porque son más espaciosos',confidence:'high'},
   selection_preferences:{priority:{kind:'interior_space',evidence:'porque son más espaciosos',confidence:'high'}}}},current,{});
 const start={_property_context:{...object(previous._property_context),offered_ids:[unit.id,second.id],query:{group:'residential',category:null,scope:'catalog',operation:'search',filters:{bedrooms:3}},pending_question:{id:'property_category',act:'choose_category',candidate_ids:[unit.id,second.id]}}};
 const reference=resolvePropertyTurn([unit,second],current,start,[],meaning);
 assert.equal(object(reference.context.category_preference).confirmed,true);assert.equal(object(reference.context.category_preference).category,'penthouse');
 const verified:Row={lead:{preferred_bedrooms:5},perfil_lead:{full_name:'Cliente',residence_city:'Cuenca'},property_context:reference.context,catalogo:[unit,second],catalogo_verificacion:[unit,second],catalog_read:{complete:true},politica_comercial:{precios_autorizados:true},
  semantica_turno:meaning,hechos_confirmados:{budget:{status:'maximum_total',amount:600000,confidence:'high',evidence:'600 mil'}},contrato_turno:{current_message:current,requests:[{domain:'property',topics:['purchase_price'],confidence:'high'}]}};
 const plan=commercialJourneyPlan(verified);assert.equal(plan.requires_unit_presentation,true);assert.equal((object(plan.selection_scope).unit_ids as string[]).length,2);
 const evidence=taskModelEvidence({units:[unit,second],groups:[]},{...verified,siguiente_paso_comercial:plan,prompt_context_selection:{version:'task-context-v1',task:'price_summary'}});
 assert.equal(evidence.units.length,2);assert.equal(evidence.units[0].bathrooms_full,3);assert.equal(evidence.units[1].bathrooms_full,2);
});
function semantics(current: string, kind = 'selected') {
    return normalizeTurnSemantics({ turn_semantics: { primary_intent: 'ask_price', primary_evidence: current, confidence: 'high',
            property: { category: 'penthouse', group: 'residential', operation: 'details', query_scope: 'selected', reference_kind: 'explicit', unit_numbers: ['605'], filters: {}, evidence: current, confidence: 'high' },
            unit_choice: { kind, evidence: current, unit_numbers: ['605'], confidence: 'high' } } }, current, {});
}
test('relative choice with a price question selects a unique current focus; price alone does not',()=>{
 for(const kind of ['selected','none']){
  const current=kind==='selected'?'ese es el que me gusta más, ¿qué precio tenía?':'¿qué precio tenía?';
  const meaning=normalizeTurnSemantics({turn_semantics:{primary_intent:'ask_price',primary_evidence:current,confidence:'high',
    property:{category:'penthouse',group:'residential',operation:'details',query_scope:'offered',reference_kind:'followup',unit_numbers:[],filters:{},evidence:current,confidence:'high'},
    unit_choice:{kind,unit_numbers:['605'],evidence:current,confidence:'high'}}},current,{});
  const start={_property_context:{...object(previous._property_context),query:{category:'penthouse',group:'residential',scope:'offered',operation:'details',filters:{bedrooms:3}}}};
  const reference=resolvePropertyTurn([unit],current,start,[],meaning);
  assert.equal(reference.needsClarification,false);assert.equal(reference.matches[0]?.id,unit.id);
  assert.deepEqual(reference.context.selected_ids,kind==='selected'?[unit.id]:[]);
 }
});
test('compound preference and price retain both actions and require the selected unit tour', () => {
    const current = 'entonces el 605 me gusta más\ny qué precio tenía disculpe?';
    const meaning = semantics(current), reference = resolvePropertyTurn([unit], current, previous, [], meaning);
    assert.equal(meaning.primary_intent, 'ask_price');
    assert.deepEqual(reference.context.selected_ids, [unit.id]);
    assert.equal(reference.query.operation, 'select');
    const tour = selectedUnitModelDelivery(reference, current, []);
    assert.equal(tour?.unit_number, '605');
    assert.ok(replyLinkContract('', { unit_model: tour }, { current, verified: { property_context: reference.context } }).required_links.includes('https://www.lavilett.com/tour?unidad=605'));
});
test('asking price alone resolves a subject without making a commercial choice or inventing incompatible requirements', () => {
    const current = 'qué precio tiene el 605?', reference = resolvePropertyTurn([unit], current, previous, [], semantics(current, 'none'));
    assert.deepEqual(reference.context.selected_ids, []);
    const plan = commercialJourneyPlan({ lead: { preferred_bedrooms: 5 }, perfil_lead: { full_name: 'Cliente', residence_city: 'Cuenca' }, property_context: reference.context,
        catalogo: [unit], catalogo_verificacion: [unit], catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true }, hechos_confirmados: { property: { category: 'penthouse', confidence: 'high', evidence: 'quiero penthouses' }, budget: { status: 'maximum_total', amount: 600000, confidence: 'high', evidence: '600 mil' } }, semantica_turno: semantics(current, 'none') });
    assert.notEqual(plan.action, 'clarify_requirements');
});
test('a condition or negation never becomes the new independent choice', () => {
    for (const [current, kind] of [['El 605 me gusta, pero necesito cinco dormitorios', 'conditional'], ['no quiero el 605', 'selected']]) {
        const reference = resolvePropertyTurn([unit], current, previous, [], semantics(current, kind));
        assert.deepEqual(reference.context.selected_ids, []);
    }
});
test('resolved unit sources survive an older clarify-choice projection for writer and reviewer', () => {
    const evidence = taskModelEvidence({ units: [unit], groups: [] }, { prompt_context_selection: { version: 'task-context-v1', task: 'clarify_choice' }, politica_comercial: { precios_autorizados: true },
        property_context: { reference_resolution: { status: 'resolved', resolved_ids: [unit.id] }, query: { scope: 'selected', operation: 'details', category: 'penthouse' } }, siguiente_paso_comercial: { action: 'clarify_requirements' } });
    assert.equal(evidence.units.length, 1);
    assert.equal(evidence.units[0].published_commercial_price, 337272);
});
test('showroom form name is retained and residence is not a brochure prerequisite', () => {
    const profile = { entry_origin: 'showroom', full_name: 'Cliente', sources: { full_name: { source: 'showroom_form', evidence: 'Cliente', record_id: 'record' } } };
    const result = leadIntroductionTurn({ current: 'sí quiero información', summary: { _lead_profile: profile, _showroom_entry: { response_kind: 'information' } }, profile, history: [], reply: 'Podemos contarle sobre el proyecto.' });
    assert.equal(object(result.audit.profile_introduction).capture_context, 'showroom');
    assert.equal(object(result.audit.profile_introduction).brochure_deferred, false);
    assert.equal(object(object(result.audit.profile_introduction).profile_state).full_name, 'Cliente');
});
test('showroom interest needs sufficient dominant active dwell or a specific request, never a tie', () => {
    assert.equal(observedShowroomUnit([{ unit_id: 'a', seconds: 120 }, { unit_id: 'b', seconds: 100 }]), null);
    assert.equal(observedShowroomUnit([{ unit_id: 'a', seconds: 180 }, { unit_id: 'b', seconds: 60 }]), 'a');
    assert.equal(observedShowroomUnit([{ unit_id: 'a', seconds: 119 }]), null);
    assert.equal(observedShowroomUnit([], 'requested-unit'), 'requested-unit');
    assert.equal(showroomButtonReply('Sí, quiero información'), 'information');
    assert.equal(showroomButtonReply('Sí\nquiero información'), 'information');
    assert.equal(showroomButtonReply('Más adelante'), 'later');
    assert.equal(showroomButtonReply('No recibir mensajes'), 'stop');
    assert.equal(showroomButtonReply('sí, pero quiero saber de financiamiento'), null);
});
test('reservation wording and an overdue ordinary inquiry have high attention priority for different reasons',()=>{
 const reservation={sla_status:'no_aplica' as const,handoff_reason:'Solicitó iniciar una reserva',last_visit_status:null};
 assert.equal(advisorAttentionPriority(reservation),'high');assert.equal(advisorAttentionPriorityReason(reservation),'Solicitud de reserva');
 const overdue={...reservation,sla_status:'vencido' as const,handoff_reason:'Atender una consulta sin respuesta'};
 assert.equal(advisorAttentionPriority(overdue),'high');assert.equal(advisorAttentionPriorityReason(overdue),'Plazo de respuesta vencido');
});
test('conversation labels prefer a declared name, then a WhatsApp alias, without showing Kommo IDs', () => {
    assert.equal(contactDisplayName('Carlos', 'Alias'), 'Carlos');
    assert.equal(contactDisplayName('Lead Kommo #4454162', 'Alias'), 'Alias');
    assert.equal(contactDisplayName('', null, '0991234567'), 'WhatsApp ····4567');
});
test('showroom outreach requires the approved body and all three approved buttons',()=>{
 const template={type:'waba',content:showroomInvitationBody('{{lead.cf.538638}}'),_embedded:{reviews:[{status:'approved'}]},buttons:['Sí, quiero información','Más adelante','No recibir mensajes'].map(text=>({type:'inline',text}))};
 assert.equal(approvedShowroomTemplate(template,'unit'),true);
 assert.equal(approvedShowroomTemplate({...template,buttons:[]},'unit'),false);
 assert.equal(approvedShowroomTemplate({...template,_embedded:{reviews:[]}},'unit'),false);
 assert.equal(approvedShowroomTemplate(template,'general'),false);
});

test('typing accepts only a real Meta message ID and transport failure does not fail the reply', async (t) => {
    const keys = ['WHATSAPP_CLOUD_ACCESS_TOKEN', 'WHATSAPP_CLOUD_PHONE_NUMBER_ID', 'WHATSAPP_GRAPH_VERSION'];
    const old = keys.map(key => process.env[key]);
    t.after(() => keys.forEach((key, index) => { if (old[index] === undefined)
        delete process.env[key];
    else
        process.env[key] = old[index]; }));
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN = 'test';
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = '123';
    process.env.WHATSAPP_GRAPH_VERSION = 'v23.0';
    let calls = 0;
    const send: typeof fetch = async (_url, init) => { calls++; assert.equal(JSON.parse(String(init?.body)).typing_indicator.type, 'text'); return new Response('{}', { status: 200 }); };
    assert.equal((await showWhatsAppTyping('internal-kommo-id', send)).shown, false);
    assert.equal(calls, 0);
    assert.equal((await showWhatsAppTyping('wamid.ABC', send)).shown, true);
    assert.equal((await showWhatsAppTyping('wamid.ABC', async () => { throw Error('offline'); })).shown, false);
});
