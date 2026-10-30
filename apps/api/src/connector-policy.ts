/**
 * Policy-shape adaptation of OpenOSINT's openosint/tool_policy.py at
 * 4acf13d6c27e2c10cdb0cfc7d1c732653cb3b42f. See research/osint/DECISION.md.
 *
 * MIT License — Copyright (c) 2026 OpenOSINT
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * INVEOS changes: explicit outbound recipients, separate local/third-party/
 * subject/unknown effects, no inherited fan-out permission or ambient active
 * flag, immutable profile and compulsory versioned authority. Classification
 * alone never authorises a request. No upstream runtime imports/dependencies.
 */
import {createHash} from 'node:crypto';
export type CollectionEffect='local_only'|'third_party_lookup'|'contacts_subject'|'unverified';
export type ConnectorDefinition={id:string;title:string;effect:CollectionEffect;recipient:string;note:string;operation:'company_profile'|'rdap_domain'|'supplied_webpage';maxResponseBytes:number;deadlineMs:number;serviceWindowSeconds:number;serviceWindowRequests:number};
export const companyProfileConnector:Readonly<ConnectorDefinition>=Object.freeze({
 id:'companies_house_profile_v1',title:'Companies House company profile',effect:'third_party_lookup',recipient:'api.company-information.service.gov.uk',
 note:'The company number is sent to Companies House. The request does not contact the company, but the provider can log it. Public availability does not establish permitted use.',
 operation:'company_profile',maxResponseBytes:262144,deadlineMs:10000,serviceWindowSeconds:300,serviceWindowRequests:600,
});
export const connectorProfile=JSON.stringify(companyProfileConnector);
export const connectorProfileDigest=createHash('sha256').update(connectorProfile).digest('hex');
export function findConnector(id:string):Readonly<ConnectorDefinition>|null{return connectorDefinitions.find(p=>p.id===id)??null;}
export function companyIdentifier(value:unknown):string{
 if(typeof value!=='string'||!/^[A-Z0-9]{8}$/.test(value))throw new Error('Use the exact eight-character uppercase company identifier.');return value;
}
export function companyProfileUrl(identifier:unknown):string{return 'https://'+companyProfileConnector.recipient+'/company/'+companyIdentifier(identifier);}

// No live transport is registered for these profiles. The recipient is a policy
// constraint, not a URL to fetch. Keep the original company profile bytes stable.
export const rdapDomainConnector:Readonly<ConnectorDefinition>=Object.freeze({
 id:'rdap_domain_v1',title:'RDAP domain registration',effect:'third_party_lookup',recipient:'explicit policy endpoint only',
 note:'Bounded supplied responses and fictional fixed-endpoint transport. No live registry, bootstrap, entity, contact or linked URL requests. Provider activation requires separate approval and transport qualification.',
 operation:'rdap_domain',maxResponseBytes:262144,deadlineMs:10000,serviceWindowSeconds:300,serviceWindowRequests:30,
});
export const suppliedWebpageConnector:Readonly<ConnectorDefinition>=Object.freeze({
 id:'supplied_webpage_v1',title:'Supplied webpage — preserved original',effect:'local_only',recipient:'none',
 note:'Preserves supplied UTF-8 HTML or text with a declared URL and timestamps. HTML is displayed as escaped source text only; scripts, links and subresources are never executed or fetched.',
 operation:'supplied_webpage',maxResponseBytes:262144,deadlineMs:10000,serviceWindowSeconds:300,serviceWindowRequests:30,
});
export const connectorDefinitions=[companyProfileConnector,rdapDomainConnector,suppliedWebpageConnector] as const;
export function profileDigestFor(id:string):string|null{const p=findConnector(id);return p?createHash('sha256').update(JSON.stringify(p)).digest('hex'):null;}
