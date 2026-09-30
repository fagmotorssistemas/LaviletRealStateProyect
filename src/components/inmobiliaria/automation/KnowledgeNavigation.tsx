import Link from 'next/link'
import { KNOWLEDGE_SECTIONS, knowledgeHref } from '@/lib/inmobiliaria/knowledgeSections'
import styles from './KnowledgeCenter.module.css'

export function KnowledgeNavigation({ active }: { active?: string }) {
  return <nav className={styles.navigation} aria-label="Conocimiento y reglas">
    {KNOWLEDGE_SECTIONS.map(section => <Link key={section.id} href={knowledgeHref(section.id)}
      aria-current={section.id === active ? 'page' : undefined}>{section.label}</Link>)}
  </nav>
}
