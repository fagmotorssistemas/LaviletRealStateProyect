import { unstable_isUnrecognizedActionError } from 'next/navigation'
import { LOGIN_TRANSPORT_MESSAGE, type LoginState } from './login-result'

/** Keep action/transport failures in the form; never retry credentials automatically. */
export async function submitLogin(
  action: (previous: LoginState, data: FormData) => Promise<LoginState>,
  previous: LoginState,
  data: FormData,
  navigate: (destination: string) => void,
  refreshOutdatedForm: () => void,
): Promise<LoginState> {
  try {
    const result = await action(previous, data)
    if (result?.destination) {
      // Mount the destination with the newly saved cookies, not the anonymous layout.
      navigate(result.destination)
    }
    return result
  } catch (error) {
    // Next confirms this action did not exist, so no credentials were processed.
    // Fetch the current form once; do not retry the login or retain the password.
    if (unstable_isUnrecognizedActionError(error)) {
      try {
        refreshOutdatedForm()
        return { error: 'Actualizando la página de acceso…' }
      } catch {
        return { error: LOGIN_TRANSPORT_MESSAGE }
      }
    }
    return { error: LOGIN_TRANSPORT_MESSAGE }
  }
}
