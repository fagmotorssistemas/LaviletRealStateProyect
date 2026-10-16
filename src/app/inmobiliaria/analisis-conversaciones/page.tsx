'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getConversationAnalysisDashboard, evaluateConversation } from './actions';
const categoryLabels: Record<string, string> = { suite: "Suite", departamento: "Departamento", penthouse: "Penthouse", local: "Local comercial" };
const temperatureLabels: Record<string, string> = { frio: "Fr\u00edo", tibio: "Tibio", caliente: "Caliente" };
type Item = Awaited<ReturnType<typeof getConversationAnalysisDashboard>>[number];
const reasons: Record<string, string> = { price: 'Precio', location: 'Ubicación', product_fit: 'Características buscadas', financing: 'Financiamiento', timing: 'Plazo de compra', unanswered: 'Consulta pendiente', technical_failure: 'Incidencia técnica', unknown: 'Sin motivo determinado', not_dropped: 'Conversación activa' };
function Chart({ title, values }: {
    title: string;
    values: string[];
}) {
    const counts = Object.entries(values.reduce<Record<string, number>>((a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...counts.map(row => row[1]));
    return <section className="rounded-xl border border-stone-200 bg-white p-5"><h2 className="mb-4 font-semibold">{title}</h2>{counts.length ? counts.map(([name, n]) => <div key={name} className="mb-3"><div className="mb-1 flex justify-between gap-3 text-sm"><span>{name}</span><span>{n}</span></div><div className="h-2 rounded bg-stone-100"><div className="h-2 rounded bg-[#787d62]" style={{ width: `${100 * n / max}%` }}/></div></div>) : <p>Sin datos registrados.</p>}</section>;
}
export default function ConversationAnalysisPage() {
    const [ready,setReady]=useState(false);
    const [items, setItems] = useState<Item[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(''), [project, setProject] = useState(''), [query, setQuery] = useState(''), [focusId, setFocusId] = useState('');
    const load = async () => { try {
        setItems(await getConversationAnalysisDashboard());
        setReady(true);
        setError('');
    }
    catch {
        setError('No se pudo cargar el análisis. Compruebe la conexión y la migración del panel.');
    } };
    useEffect(() => { let active = true; void getConversationAnalysisDashboard().then(data => { if (active) {
        setItems(data);
        setReady(true);
        setFocusId(new URL(window.location.href).searchParams.get('lead') || '');
    } }).catch(() => { if (active)
        setError('No se pudo cargar el análisis. Compruebe la conexión y la migración del panel.'); }); return () => { active = false; }; }, []);
    const visible = items.filter(row => (!focusId || row.id === focusId) && (!project || row.projectId === project) && (!query || row.name.toLowerCase().includes(query.toLowerCase())));
    const evaluate = async (id: string) => { setBusy(id); try {
        await evaluateConversation(id);
        await load();
    }
    catch {
        setError('No se pudo completar la evaluación. El lead y su conversación se conservan.');
    }
    finally {
        setBusy('');
    } };
    if(!ready)return <main className="mx-auto max-w-7xl space-y-6 p-6 text-stone-700"><h1 className="font-display text-3xl">Análisis de conversaciones</h1><p role="status">{error||'Cargando información…'}</p>{error&&<button className="rounded-lg border px-4 py-2" onClick={()=>void load()}>Reintentar</button>}</main>;
    return <main className="mx-auto max-w-7xl space-y-6 p-6 text-stone-700"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-3xl">Análisis de conversaciones</h1><button onClick={() => void load()} className="rounded-lg border px-4 py-2">Actualizar datos</button></div>
 <p>Resúmenes y posibles motivos de pausa respaldados por la conversación. El silencio no confirma pérdida de interés. Las evaluaciones no cambian etapas ni envían mensajes.</p>
 {error && <p role="alert" className="rounded-lg bg-amber-50 p-4">{error}</p>}{focusId && <button className="underline" onClick={() => setFocusId('')}>Ver todos los leads</button>}
 <div className="flex flex-wrap gap-3"><input aria-label="Buscar lead" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre" className="rounded-lg border p-2"/><select aria-label="Proyecto" value={project} onChange={e => setProject(e.target.value)} className="rounded-lg border p-2"><option value="">Todos los proyectos accesibles</option>{[...new Set(items.map(row => row.projectId))].filter(Boolean).map(id => <option key={id} value={id}>{items.find(row => row.projectId === id)?.projectName}</option>)}</select><span className="p-2">{visible.length} leads · {visible.filter(row => row.analysis).length} evaluados</span></div>
 <div className="grid gap-4 md:grid-cols-2"><Chart title="Residencia declarada" values={visible.map(row => row.residence)}/><Chart title="Origen del contacto" values={visible.map(row => row.source)}/><Chart title="Tipo de inmueble declarado" values={visible.map(row => (categoryLabels[row.category] || row.category))}/><Chart title="Temperatura comercial" values={visible.map(row => (temperatureLabels[row.temperature] || "Sin temperatura"))}/><Chart title="Motivos en evaluaciones con evidencia" values={visible.filter(row => row.analysis && !row.stale && row.analysis.basis === 'explicit').map(row => reasons[String(row.analysis?.reason)] || 'Sin determinar')}/></div>
 <div className="space-y-4">{visible.map(row => <article key={row.id} className="rounded-xl border border-stone-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><Link className="font-semibold underline" href={`/inmobiliaria/automatizacion?lead=${row.id}`}>{row.name}</Link><button disabled={!!busy} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void evaluate(row.id)}>{busy === row.id ? 'Evaluando…' : row.analysis ? 'Revisar evaluación' : 'Evaluar conversación'}</button></div>
 {row.analysis ? <div className="mt-3 space-y-2"><p>{String(row.analysis.summary || '')}</p><p><strong>Objetivo:</strong> {String(row.analysis.goal || 'Sin determinar')}</p><p><strong>{row.analysis.basis === 'explicit' ? 'Motivo declarado' : row.analysis.basis === 'hypothesis' ? 'Hipótesis para revisar' : 'Sin causa confirmada'}:</strong> {String(row.analysis.explanation || '')}</p>{row.stale && <p className="text-amber-800">Hay mensajes posteriores a esta evaluación.</p>}<p><strong>Siguiente paso sugerido:</strong> {String(row.analysis.next_step || '')}</p>{Array.isArray(row.analysis.evidence) && row.analysis.evidence.map((e, index) => <blockquote key={index} className="border-l-2 border-stone-300 pl-3 text-sm">{String((e as {
            quote: string;
        }).quote)}</blockquote>)}<p className="text-xs text-stone-500">Evaluación guardada: {row.reviewAt ? new Date(row.reviewAt).toLocaleString('es-EC') : ''}</p></div> : <p className="mt-3 text-sm">Todavía no hay una evaluación guardada.</p>}</article>)}</div>
 </main>;
}
