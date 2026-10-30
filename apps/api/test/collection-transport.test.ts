import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress,companiesHouseTransport} from '../src/collection-transport.js';
import {companyProfileUrl} from '../src/connector-policy.js';
test('OSINT fixed destination rejects special-use addresses and arbitrary URL-shaped identifiers',async()=>{
 for(const ip of ['127.0.0.1','0.0.0.0','10.2.3.4','172.16.1.1','172.31.255.255','192.168.1.2','169.254.169.254','100.64.0.1','100.127.255.255','192.0.0.9','192.0.2.1','198.18.0.1','198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::','not-an-address'])assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicAddress(ip),true,ip);
 for(const value of ['https://example.invalid/','FIC00001?key=secret','../admin','fic00001','FIC00001#x','FIC00001/','FIC0000\n'])assert.throws(()=>companyProfileUrl(value));
 assert.equal(companyProfileUrl('FIC00001'),'https://api.company-information.service.gov.uk/company/FIC00001');assert.throws(()=>companiesHouseTransport('short'));assert.throws(()=>companiesHouseTransport('fictional:credential'));
 // Invalid scope fails before DNS or a provider request, even with syntactically valid fixture credentials.
 await assert.rejects(companiesHouseTransport('fictional-credential-not-valid-at-provider')('../admin',new AbortController().signal));
});
