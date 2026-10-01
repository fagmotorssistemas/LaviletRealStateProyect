/** Compose instructions with explicit boundaries; context and JSON schemas stay separate. */
export function promptSections(sections: [title: string, instructions: string | false | null | undefined][]): string {
  return sections.filter(([, body]) => typeof body === 'string' && body.trim())
    .map(([title, body]) => `# ${title}\n\n${String(body).trim().replace(/^(#{1,5}) /gm, '#$1 ')}`).join('\n\n')
}
