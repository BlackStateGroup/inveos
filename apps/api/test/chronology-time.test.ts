import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AllegedTime} from '@inveos/contracts';
import {validateAllegedTime} from '../src/chronology.js';
const time=(precision:AllegedTime['precision'],start:string|null,end:string|null=null):AllegedTime=>({precision,start,end,timezone:'',note:'Fictional account; precision only as recorded.'});
test('alleged dates preserve calendar precision, explicit offsets and overlapping ranges',()=>{
 for(const value of [time('unknown',null),time('day','2024-02-29'),time('day','2026-10-25'),time('month','2026-01'),time('instant','2026-10-25T01:30:00+01:00'),time('instant','2026-10-25T01:30:00+00:00'),time('instant','2026-10-25T12:34:56.12Z'),time('instant','2026-10-25T00:00:00+14:00'),time('range','2026-10-25T01:30:00+01:00','2026-10-25T01:00:00Z'),time('range','2026-10-25T01:00:00Z','2026-10-25T01:00:00Z')]){const before=JSON.stringify(value);validateAllegedTime(value);assert.equal(JSON.stringify(value),before);}
});
test('alleged dates reject invented precision, rollover dates, floating instants and reversed UTC ranges',()=>{
 for(const value of [time('unknown','2026-01'),time('day','2026-02-29'),time('day','2026-04-31'),time('day','2026-01-01T00:00:00Z'),time('month','2026-1'),time('month','2026-13'),time('instant','2026-01-01T12:00:00'),time('instant','2026-01-01T24:00:00Z'),time('instant','2026-01-01T12:00:00-00:00'),time('instant','2026-01-01T12:00:00+14:01'),time('instant','2026-02-30T12:00:00Z'),time('instant','2026-01-01T12:00:60Z'),time('range','2026-10-25T01:30:00Z','2026-10-25T01:45:00+01:00'),time('range','2026-01-01',null)])assert.throws(()=>validateAllegedTime(value));
});
