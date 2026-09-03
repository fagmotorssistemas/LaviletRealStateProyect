import type { MarkerConfig } from '@photo-sphere-viewer/markers-plugin'
import type { VirtualTourLink, VirtualTourNode } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { PanoramaVariants, TourHotspot } from '@/types/tour'

export type TourNodesResult = {
  nodes: VirtualTourNode[]
  startNodeId: string | undefined
}

export type TourNodeSource = {
  id: string
  room: string
  roomLabel: string | null
  url: string
  variants: PanoramaVariants
  hotspots: TourHotspot[]
  initialYaw: number
  initialPitch: number
  mapX: number | null
  mapY: number | null
  mapHeading: number | null
  finishSlug: string | null
}

export function pickVariantUrl(
  baseUrl: string,
  variants: PanoramaVariants,
  preferredWidth: number,
): string {
  const v = variants[String(preferredWidth)]
  if (v?.url) return v.url
  return baseUrl
}

function hotspotsToMarkers(hotspots: TourHotspot[]): MarkerConfig[] {
  return hotspots
    .filter((h) => h.type !== 'link')
    .map((h) => ({
      id: h.id,
      position: { yaw: h.yaw, pitch: h.pitch },
      html:
        h.html ??
        `<span style="display:flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:999px;background:#BDA27E;color:#2B1A18;font:600 13px/1 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)">i</span>`,
      tooltip: h.tooltip ? { content: h.tooltip, position: 'top' as const } : undefined,
      style: h.style,
      anchor: 'center center' as const,
    }))
}

function hotspotsToLinks(hotspots: TourHotspot[]): VirtualTourLink[] {
  return hotspots
    .filter((h): h is TourHotspot & { target_room: string } => h.type === 'link' && !!h.target_room)
    .map((h) => ({
      nodeId: h.target_room,
      position: { yaw: h.yaw, pitch: h.pitch },
    }))
}

/** Convierte filas de panorámica al shape de VirtualTourNode que consume el plugin. */
export function buildTourNodes(
  sources: TourNodeSource[],
  preferredWidth: number,
): TourNodesResult {
  const nodes: VirtualTourNode[] = sources.map((p) => {
    const hotspots = Array.isArray(p.hotspots) ? p.hotspots : []
    const panorama = pickVariantUrl(p.url, p.variants ?? {}, preferredWidth)

    const node: VirtualTourNode = {
      id: p.room,
      panorama,
      name: p.roomLabel ?? p.room,
      caption: p.roomLabel ?? p.room,
      links: hotspotsToLinks(hotspots),
      markers: hotspotsToMarkers(hotspots),
      data: {
        panoramaId: p.id,
        room: p.room,
        initialYaw: p.initialYaw,
        initialPitch: p.initialPitch,
        mapX: p.mapX,
        mapY: p.mapY,
        mapHeading: p.mapHeading,
        finishSlug: p.finishSlug,
        url: p.url,
        variants: p.variants ?? {},
      },
    }

    if (p.mapX != null && p.mapY != null) {
      node.map = { x: p.mapX, y: p.mapY }
    }

    return node
  })

  return { nodes, startNodeId: nodes[0]?.id }
}
