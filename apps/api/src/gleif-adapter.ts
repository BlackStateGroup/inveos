/** First-party bounded JSON:API record interpretation. Official-document inspection:
 * research/osint/GLEIF_DECISION.md. No provider code or SDK is incorporated.
 */
import {ApiError} from './errors.js';
import {transcriptText} from './supplied-transcript.js';
export const gleifEndpoint='https://api.gleif.org/api/v1/lei-records/';
export function leiIdentifier(value:string):string{
 if(!/^[A-Z0-9]{18}[0-9]{2}$/.test(value))throw new ApiError(422,'Use one exact 20-character uppercase LEI with two final check digits.');
 let remainder=0;for(const character of value){const digits=/[0-9]/.test(character)?character:String(character.charCodeAt(0)-55);for(const digit of digits)remainder=(remainder*10+Number(digit))%97;}
 if(remainder!==1)throw new ApiError(422,'LEI check digits do not match. Check digits do not establish registration or identity.');return value;
}
// This identifier is generated locally for a fictional fixture, never looked up.
export const fictionalLei='000000FICTIONAL00040';
export function gleifRecordUrl(lei:string,endpoint:string):string{if(endpoint!==gleifEndpoint)throw new ApiError(422,'GLEIF scope must be the exact registered HTTPS single-record endpoint.');return gleifEndpoint+leiIdentifier(lei);}
export function inspectGleifRecord(parsed:unknown,lei:string):{pointer:string;value:string}[]{
 const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new ApiError(422,'GLEIF capture must contain exactly one JSON:API record.');return v as Record<string,unknown>;};
 const root=object(parsed),data=object(root.data),attributes=object(data.attributes),entity=object(attributes.entity),name=object(entity.legalName),registration=object(attributes.registration);
 if(root.errors!==undefined||data.type!=='lei-records'||data.id!==lei||attributes.lei!==leiIdentifier(lei))throw new ApiError(422,'GLEIF record type or exact LEI differs from the authorised request.');
 const fields:{pointer:string;value:string}[]=[];
 const add=(pointer:string,value:unknown)=>{if(typeof value!=='string'||!value.trim()||!transcriptText(value,1000))throw new ApiError(422,'Unsupported bounded LEI record field.');fields.push({pointer,value});};
 add('/data/type',data.type);add('/data/id',data.id);add('/data/attributes/lei',attributes.lei);add('/data/attributes/entity/legalName/name',name.name);
 if(name.language!==undefined)add('/data/attributes/entity/legalName/language',name.language);
 for(const key of ['jurisdiction','category','status','registeredAs'])if(entity[key]!==undefined)add('/data/attributes/entity/'+key,entity[key]);
 for(const key of ['status','initialRegistrationDate','lastUpdateDate','nextRenewalDate'])if(registration[key]!==undefined)add('/data/attributes/registration/'+key,registration[key]);
 // Names/identifiers/statuses remain unreviewed source assertions. No addresses,
 // persons, relationships, mapped identifiers, links or pagination are followed.
 return fields;
}
