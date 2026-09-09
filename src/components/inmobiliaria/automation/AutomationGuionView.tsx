'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { MessageSquareText } from 'lucide-react'
import { AutomationSectionTabs } from '@/components/inmobiliaria/automation/AutomationSectionTabs'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listProjects } from '@/services/inmobiliaria.service'
import {
  addScriptQuestionAction,
  addTopicPromptAction,
  deleteScriptQuestionAction,
  loadAutomationGuionAction,
  saveScriptQuestionsAction,
  saveTopicPromptAction,
  seedScriptQuestionsAction,
} from '@/app/inmobiliaria/automatizacion/guion/actions'
import {
  SCRIPT_STAGE_OPTIONS,
  topicPromptLabel,
  type ScriptQuestionRow,
  type ScriptStage,
  type TopicPromptRow,
} from '@/types/automationGuion'
import type { Project } from '@/types/inmobiliaria'

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[#3a3d36]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-gray-300"
      />
      {label}
    </label>
  )
}

function GuionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#3a3d36]">{title}</h2>
          <p className="mt-1 text-sm text-[#7a7e70]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function AutomationGuionView() {
  const router = useRouter()
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [questions, setQuestions] = useState<ScriptQuestionRow[]>([])
  const [topics, setTopics] = useState<TopicPromptRow[]>([])
  const [openTopicId, setOpenTopicId] = useState<number | null>(null)
  const [newQuestion, setNewQuestion] = useState('')
  const [newStage, setNewStage] = useState<ScriptStage>('lanzamiento')
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicWhen, setNewTopicWhen] = useState('')
  const [newTopicContent, setNewTopicContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (roleLoading) return
    if (!isAdmin) router.replace('/inmobiliaria/automatizacion')
  }, [isAdmin, roleLoading, router])

  const loadProjects = useCallback(async () => {
    if (authLoading || !user) return
    const ids = await getAccessibleTenantIds(supabase)
    if (!ids.length) {
      setProjects([])
      return
    }
    const rows = await listProjects(supabase, ids[0], ids)
    setProjects(rows)
    setProjectId((current) => current || rows[0]?.id || '')
  }, [authLoading, supabase, user])

  const loadGuion = useCallback(async (id: string) => {
    if (!id) return
    setIsLoading(true)
    try {
      const payload = await loadAutomationGuionAction(id)
      setQuestions(payload.questions)
      setTopics(payload.topics)
      setOpenTopicId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el guion')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (!projectId || !isAdmin) {
      if (!projectId && isAdmin) setIsLoading(false)
      return
    }
    void loadGuion(projectId)
  }, [isAdmin, loadGuion, projectId])

  const saveQuestions = async () => {
    setSaving('questions')
    try {
      await saveScriptQuestionsAction(projectId, questions)
      toast.success('Preguntas guardadas')
      await loadGuion(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar las preguntas')
    } finally {
      setSaving(null)
    }
  }

  const seedQuestions = async () => {
    setSaving('seed')
    try {
      await seedScriptQuestionsAction(projectId)
      toast.success('Se crearon las 4 preguntas de lanzamiento')
      await loadGuion(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron crear las preguntas')
    } finally {
      setSaving(null)
    }
  }

  const addQuestion = async () => {
    if (!newQuestion.trim()) {
      toast.error('Escribe la pregunta')
      return
    }
    setSaving('add-question')
    try {
      const nextOrder = questions.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10
      await addScriptQuestionAction({
        projectId,
        stage: newStage,
        questionText: newQuestion,
        sortOrder: nextOrder,
      })
      setNewQuestion('')
      toast.success('Pregunta añadida')
      await loadGuion(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo añadir la pregunta')
    } finally {
      setSaving(null)
    }
  }

  const removeQuestion = async (id: string) => {
    setSaving(`delete-${id}`)
    try {
      await deleteScriptQuestionAction(projectId, id)
      toast.success('Pregunta quitada')
      await loadGuion(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo quitar la pregunta')
    } finally {
      setSaving(null)
    }
  }

  const saveTopic = async (row: TopicPromptRow) => {
    setSaving(`topic-${row.id}`)
    try {
      await saveTopicPromptAction({
        id: row.id,
        content: row.content,
        load_when: row.load_when ?? '',
        is_active: row.is_active,
        version: row.version,
      })
      toast.success('Respuesta guardada')
      await loadGuion(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la respuesta')
    } finally {
      setSaving(null)
    }
  }

  const addTopic = async () => {
    if (!newTopicName.trim() || !newTopicContent.trim()) {
      toast.error('Nombre y texto son obligatorios')
      return
    }
    setSaving('add-topic')
    try {
      await addTopicPromptAction({
        projectId,
        name: newTopicName,
        loadWhen: newTopicWhen,
        content: newTopicContent,
        mode: 'lanzamiento',
      })
      setNewTopicName('')
      setNewTopicWhen('')
      setNewTopicContent('')
      toast.success('Tema añadido')
      await loadGuion(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo añadir el tema')
    } finally {
      setSaving(null)
    }
  }

  if (roleLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Automatización"
        title="Guion"
        description="Qué pregunta el bot y cómo responde. No cambia horario, puntaje ni nutrición."
      />
      <AutomationSectionTabs active="guion" />

      <div className="max-w-sm">
        <Select
          label="Proyecto"
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          placeholder="Elige un proyecto"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        />
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="No hay proyectos"
          description="Crea un proyecto antes de editar el guion."
        />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <GuionCard
            title="Qué pregunta el bot"
            description="Una pregunta por mensaje, en este orden. Quitar es apagar o borrar la fila. Al guardar se inyecta en el agente comercial del proyecto."
            action={
              questions.length ? (
                <Button onClick={() => void saveQuestions()} disabled={saving === 'questions'}>
                  {saving === 'questions' ? 'Guardando...' : 'Guardar preguntas'}
                </Button>
              ) : (
                <Button onClick={() => void seedQuestions()} disabled={saving === 'seed'}>
                  Crear preguntas iniciales
                </Button>
              )
            }
          >
            {questions.length === 0 ? (
              <EmptyState
                icon={MessageSquareText}
                title="Todavía no hay preguntas de captura"
                description="Crea las 4 de lanzamiento (nombre, tipo de unidad, vivir o invertir, consentimiento) y ajústalas."
              />
            ) : (
              <div className="space-y-3">
                {questions.map((row, index) => (
                  <div key={row.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="grid gap-3 sm:grid-cols-[5rem_1fr_10rem_auto] sm:items-end">
                      <Input
                        label="Orden"
                        type="number"
                        value={row.sort_order}
                        onChange={(event) =>
                          setQuestions((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, sort_order: Number(event.target.value) || 0 }
                                : item,
                            ),
                          )
                        }
                      />
                      <Input
                        label={`Pregunta ${index + 1}`}
                        value={row.question_text}
                        onChange={(event) =>
                          setQuestions((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, question_text: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Select
                        label="Etapa"
                        options={SCRIPT_STAGE_OPTIONS}
                        value={row.stage}
                        onChange={(event) =>
                          setQuestions((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, stage: event.target.value as ScriptStage }
                                : item,
                            ),
                          )
                        }
                      />
                      <div className="flex flex-wrap items-center gap-3 pb-1">
                        <Toggle
                          checked={row.is_active}
                          onChange={(value) =>
                            setQuestions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, is_active: value } : item,
                              ),
                            )
                          }
                          label="Activa"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void removeQuestion(row.id)}
                          disabled={saving === `delete-${row.id}`}
                        >
                          Quitar
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <Input
                label="Nueva pregunta"
                value={newQuestion}
                placeholder="Texto que el bot debe enviar"
                onChange={(event) => setNewQuestion(event.target.value)}
              />
              <Select
                label="Etapa"
                options={SCRIPT_STAGE_OPTIONS}
                value={newStage}
                onChange={(event) => setNewStage(event.target.value as ScriptStage)}
              />
              <Button onClick={() => void addQuestion()} disabled={saving === 'add-question'}>
                Añadir
              </Button>
            </div>
          </GuionCard>

          <GuionCard
            title="Cómo responde"
            description="Edite los prompts de respuesta comercial, saludo, revisi?n, resumen y extracci?n. Los cambios guardados se leen en la siguiente conversaci?n. Los temas adicionales requieren que el ejecutor los consulte; crearlos no los activa por s? solo."
            action={null}
          >
            <div className="space-y-2">
              {topics.map((row) => {
                const open = openTopicId === row.id
                return (
                  <div key={row.id} className="rounded-lg border border-gray-100">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                      onClick={() => setOpenTopicId(open ? null : row.id)}
                    >
                      <span>
                        <span className="font-medium text-[#3a3d36]">{topicPromptLabel(row.name)}</span>
                        <span className="ml-2 text-xs text-[#7a7e70]">{row.load_when || 'Sin disparador'}</span>
                      </span>
                      <span className="text-xs text-[#7a7e70]">{row.is_active ? 'Activo' : 'Apagado'}</span>
                    </button>
                    {open ? (
                      <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                        <Input
                          label="Cuándo usarlo"
                          value={row.load_when ?? ''}
                          onChange={(event) =>
                            setTopics((current) =>
                              current.map((item) =>
                                item.id === row.id ? { ...item, load_when: event.target.value } : item,
                              ),
                            )
                          }
                        />
                        <Textarea
                          label="Instrucción / respuesta"
                          rows={6}
                          value={row.content}
                          onChange={(event) =>
                            setTopics((current) =>
                              current.map((item) =>
                                item.id === row.id ? { ...item, content: event.target.value } : item,
                              ),
                            )
                          }
                        />
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Toggle
                            checked={row.is_active}
                            onChange={(value) =>
                              setTopics((current) =>
                                current.map((item) =>
                                  item.id === row.id ? { ...item, is_active: value } : item,
                                ),
                              )
                            }
                            label="Activo"
                          />
                          <Button
                            size="sm"
                            onClick={() => void saveTopic(row)}
                            disabled={saving === `topic-${row.id}`}
                          >
                            Guardar tema
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="grid gap-3 border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-[#3a3d36]">Añadir un tema</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Nombre"
                  value={newTopicName}
                  placeholder="Ej. estacionamiento"
                  onChange={(event) => setNewTopicName(event.target.value)}
                />
                <Input
                  label="Cuándo usarlo"
                  value={newTopicWhen}
                  placeholder="Ej. Pregunta por parqueadero"
                  onChange={(event) => setNewTopicWhen(event.target.value)}
                />
              </div>
              <Textarea
                label="Instrucción"
                rows={4}
                value={newTopicContent}
                onChange={(event) => setNewTopicContent(event.target.value)}
              />
              <div>
                <Button onClick={() => void addTopic()} disabled={saving === 'add-topic'}>
                  Añadir tema
                </Button>
              </div>
            </div>
          </GuionCard>
        </>
      )}
    </div>
  )
}
