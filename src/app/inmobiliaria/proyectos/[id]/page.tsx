'use client'

import { useParams } from 'next/navigation'
import { ProjectDetailView } from '@/components/inmobiliaria/projects/ProjectDetailView'

export default function ProyectoDetallePage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : ''

  if (!id) {
    return null
  }

  return <ProjectDetailView projectId={id} />
}
