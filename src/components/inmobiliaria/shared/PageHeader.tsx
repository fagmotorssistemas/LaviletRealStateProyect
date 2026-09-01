import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header className="crm-page-header">
      <div className="crm-page-header-row">
        <div className="crm-page-header-lead">
          <h1 className="crm-title">{title}</h1>
          {(eyebrow || description) && (
            <p className="crm-page-header-meta">
              {eyebrow ? <span className="crm-eyebrow">{eyebrow}</span> : null}
              {eyebrow && description ? <span className="crm-page-header-dot" aria-hidden>·</span> : null}
              {description ? <span className="crm-lede">{description}</span> : null}
            </p>
          )}
        </div>
        {actions ? <div className="crm-page-actions">{actions}</div> : null}
      </div>
    </header>
  )
}
