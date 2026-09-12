import { redirect } from 'next/navigation'

export default async function DepartamentoConfiguradorRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/simulador?unidad=${encodeURIComponent(id)}`)
}
