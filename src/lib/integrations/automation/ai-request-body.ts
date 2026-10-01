import type { Row } from './data'

export const AI_USER_PREFIX = 'Responda en JSON. Datos de entrada:\n'

/** Shared by transport and diagnostic export; never includes HTTP credentials. */
export function aiRequestBody(options: {
  model: string; instructions: string; input: unknown; schema?: Row;
  maxOutputTokens?: number; reasoningEffort?: string; userPrefix?: string;
  image?: string; file?: { name: string; data: string };
}) {
  return { model: options.model, store: false,
    ...(options.maxOutputTokens !== undefined ? { max_output_tokens: options.maxOutputTokens } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
    instructions: options.instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: (options.userPrefix ?? AI_USER_PREFIX) + JSON.stringify(options.input ?? null) },
      ...(options.image ? [{ type: 'input_image', image_url: options.image, detail: 'high' }] : []),
      ...(options.file ? [{ type: 'input_file', filename: options.file.name, file_data: options.file.data }] : [])] }],
    text: { format: options.schema ? { type: 'json_schema', name: 'lavilet_result', strict: true, schema: options.schema } : { type: 'json_object' } },
  }
}
