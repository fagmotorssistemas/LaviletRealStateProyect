import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  className?: string
  children?: React.ReactNode
}

export function EmptyState({ icon: Icon, title, description, className, children }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'crm-empty flex flex-col items-center justify-center border border-[#c5c8bc] bg-[#f7f7f3] px-8 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 border border-[#8b917c] bg-[#555c4a] p-3">
        <Icon size={24} className="text-[#f4f4ef]" strokeWidth={1.5} />
      </div>
      <h3 className="font-display text-xl font-semibold text-[#3a3d36]">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[#5c6156]">{description}</p>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
