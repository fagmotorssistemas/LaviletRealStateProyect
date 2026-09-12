'use client'

export function Disclaimer({ text }: { text?: string | null }) {
  return (
    <p className="rounded-2xl border border-[#ece6dc] bg-[#faf7f2] px-4 py-3 text-xs leading-relaxed text-[#6b645c]">
      {text?.trim() ||
        'Estos cálculos son estimaciones educativas basadas en datos de mercado. No constituyen asesoría financiera.'}
    </p>
  )
}
