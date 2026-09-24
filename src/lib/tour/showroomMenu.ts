import type { TourUnitSummary } from '@/types/tour'
export type UnitFilters={floor:string;bedrooms:string;category:string;status:string;min:string;max:string;query:string}
export const emptyUnitFilters:UnitFilters={floor:'',bedrooms:'',category:'',status:'',min:'',max:'',query:''}
export function filterShowroomUnits(units:TourUnitSummary[],filters:UnitFilters,commercial=false){
 return units.filter(u=>(commercial?u.category==='local':u.category!=='local')
  && (!filters.floor || u.floor===filters.floor)
  && (!filters.category || u.category===filters.category)
  && (!filters.status || u.status===filters.status)
  && (!filters.bedrooms || u.bedrooms===Number(filters.bedrooms))
  && (!filters.min || (u.area_total_m2!=null && u.area_total_m2>=Number(filters.min)))
  && (!filters.max || (u.area_total_m2!=null && u.area_total_m2<=Number(filters.max)))
  && (!filters.query || u.unit_number.toLowerCase().includes(filters.query.trim().toLowerCase())))
}
export function publicShowroomUrl(unitNumber:string,origin:string){
 const url=new URL('/tour',origin);url.searchParams.set('unidad',unitNumber);return url.toString()
}
