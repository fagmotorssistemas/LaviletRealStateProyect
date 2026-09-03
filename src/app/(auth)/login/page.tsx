import { LoginForm } from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; next?: string }>
}) {
  const params = await searchParams
  return <LoginForm registered={params.registered === '1'} next={params.next} />
}
