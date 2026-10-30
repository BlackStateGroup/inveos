// Adapted from WatermelonDB's recordsToMarkAsSynced/areRecordsEqual.
// Copyright (c) Nozbe. MIT licence: third_party/watermelondb/LICENSE.
// Upstream 5c463222ecd79928861385bac94b486fcc7623d4; provenance and changes
// are recorded in third_party/watermelondb/README.md.
export type SentCapture={id:string;revision:number;fingerprint:string};
/** Only the exact local revision submitted and explicitly accepted may advance. */
export function acknowledgedUnchanged(current:readonly SentCapture[],sent:readonly SentCapture[],accepted:ReadonlyMap<string,string>):SentCapture[]{
 const result:SentCapture[]=[];
 const byId=new Map(current.map(record=>[record.id,record]));
 for(const raw of sent){
  const record=byId.get(raw.id);
  if(!record)continue;
  if(record.revision===raw.revision&&record.fingerprint===raw.fingerprint&&accepted.get(raw.id)===raw.fingerprint)result.push(record);
 }
 return result;
}
