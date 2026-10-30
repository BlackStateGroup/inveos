/** Fingerprint verification for the exact approved download, not an office editor or semantic verifier. */
export async function verifyReportDocxDownload(bytes:ArrayBuffer,expectedDocx:string,expectedReport:string,docxHeader:string|null,reportHeader:string|null){
 const fail=():never=>{throw new Error('The DOCX copy does not match its frozen fingerprints.');};
 if(!/^[a-f0-9]{64}$/.test(expectedDocx)||!/^[a-f0-9]{64}$/.test(expectedReport)||docxHeader!==expectedDocx||reportHeader!==expectedReport||bytes.byteLength<22||bytes.byteLength>33554432)return fail();
 const raw=new Uint8Array(bytes);if(raw[0]!==0x50||raw[1]!==0x4b||raw[2]!==3||raw[3]!==4)return fail();
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==expectedDocx)return fail();
 return {docxSha256:actual,sourceReportSha256:expectedReport};
}
