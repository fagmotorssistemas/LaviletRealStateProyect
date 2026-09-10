import { ExternalLink, MessageCircle } from 'lucide-react'
import { kommoLeadUrl } from '@/lib/inmobiliaria/visitPresentation'

export function KommoChatLink({ kommoId }: { kommoId?: number | string | null }) {
  const href = kommoLeadUrl(kommoId)
  if (!href) return null
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#787D62]/20 bg-white px-3 py-2 text-xs font-semibold text-[#596044] transition hover:bg-[#f5f6f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#787D62]">
    <MessageCircle size={15} aria-hidden="true" /><span>Ver chat en Kommo</span><ExternalLink size={12} aria-hidden="true" />
  </a>
}
