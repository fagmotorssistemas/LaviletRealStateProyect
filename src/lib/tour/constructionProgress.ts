/** Only approved, dated photographs/videos of the actual site belong here.
 * Empty until the project team supplies real material. No illustrative renders. */
export type ConstructionUpdate={id:string;date:string;title:string;description:string;media:Array<{type:'image'|'video';url:string;caption:string}>}
export const constructionProgress:ConstructionUpdate[]=[]
