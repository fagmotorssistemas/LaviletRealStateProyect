import { redirect } from 'next/navigation'

export default function MisEscenariosRedirect() {
  redirect('/simulador?guardados=1')
}
