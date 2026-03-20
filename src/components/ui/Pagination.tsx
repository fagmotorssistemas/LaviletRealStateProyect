'use client'

import { Button } from '@/components/ui/Button'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)

  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const end = Math.min(total, safePage * pageSize)

  const rangeStart = Math.max(1, safePage - 2)
  const rangeEnd = Math.min(totalPages, safePage + 2)
  const pages: number[] = []
  for (let p = rangeStart; p <= rangeEnd; p++) pages.push(p)

  return (
    <div className={className ?? ''}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          {total === 0 ? '0 resultados' : `Mostrando ${start}-${end} de ${total}`}
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
          >
            Anterior
          </Button>

          {rangeStart > 1 && (
            <>
              <Button
                variant={1 === safePage ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => onPageChange(1)}
                className="min-w-10"
              >
                1
              </Button>
              {rangeStart > 2 && <span className="px-1 text-sm text-gray-500">...</span>}
            </>
          )}

          {pages.map((p) => (
            <Button
              key={p}
              variant={p === safePage ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => onPageChange(p)}
              className="min-w-10"
            >
              {p}
            </Button>
          ))}

          {rangeEnd < totalPages && (
            <>
              {rangeEnd < totalPages - 1 && <span className="px-1 text-sm text-gray-500">...</span>}
              <Button
                variant={totalPages === safePage ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => onPageChange(totalPages)}
                className="min-w-10"
              >
                {totalPages}
              </Button>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  )
}

