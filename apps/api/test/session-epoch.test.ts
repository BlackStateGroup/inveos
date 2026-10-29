import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sessionEpoch,LAB_SESSION_EPOCH} from '../src/session-epoch.js';
import {loadRuntimeConfig} from '../src/config.js';
test('session generation validates configuration and normalises UUIDs without silently accepting malformed values',()=>{
 assert.equal(sessionEpoch(),LAB_SESSION_EPOCH);assert.equal(sessionEpoch('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 for(const value of ['',null,7,'generation one','00000000-0000-0000-0000-000000000000',' '+LAB_SESSION_EPOCH])assert.throws(()=>sessionEpoch(value));
 const env={INVEOS_DEV_LAB:'1',INVEOS_DATABASE_URL:'postgres://localhost/inveos_test',INVEOS_ADMIN_DATABASE_URL:'postgres://localhost/inveos_test',INVEOS_STORAGE_ROOT:'/tmp/fictional-epoch-test',INVEOS_SESSION_EPOCH:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'};
 assert.equal(loadRuntimeConfig(env).sessionEpoch,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.throws(()=>loadRuntimeConfig({...env,INVEOS_SESSION_EPOCH:''}));
});
