/** Compatibility epoch for the synthetic lab only; rotate outside backups before recovery. */
export const LAB_SESSION_EPOCH='00000000-0000-4000-8000-000000000000';
export function sessionEpoch(value:unknown=LAB_SESSION_EPOCH):string{
 if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw new Error('INVEOS_SESSION_EPOCH must be a UUID.');
 return value.toLowerCase();
}
