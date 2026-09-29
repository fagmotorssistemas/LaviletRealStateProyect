/** The conversation failed before attempting to write its reply to Kommo. */
export class PreReplySendError extends Error {
  constructor(public readonly original: unknown) {
    super('PRE_REPLY_SEND_FAILED')
  }
}
