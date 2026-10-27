/** Check exact downloaded bytes before offering a saved revision to the user. */
export async function verifyRevisionDownload(bytes:ArrayBuffer,expected:string,header:string|null):Promise<void>{
  if(!/^[a-f0-9]{64}$/.test(expected)||header!==expected)throw new Error('The downloaded revision does not match its saved fingerprint.');
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(actual!==expected)throw new Error('The downloaded revision does not match its saved fingerprint.');
}
