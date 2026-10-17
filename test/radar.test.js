import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { syncSource } from '../src/worker.js';
import { assess, contracts, eligibility, normalize, sourceURL, safeJobURL, validateProfile } from '../src/domain.js';

const profile = { roles:['developer','full-stack'], skills:['React','Node.js'], levels:['pleno','junior'], exclude:[], contracts:['CLT','PJ','Estágio'], minSalary:0 };
const base = { id:'test', title:'Full-stack Developer Pleno', company:'Empresa teste', location:'Remote - Brazil', description:'React and Node.js. CLT.', workplace:'remote', url:'https://jobs.lever.co/test/1' };
const source = { id:2, provider:'lever', slug:'cloudwalk', company:'CloudWalk' };
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql','0002_bryan_profile.sql','0003_sync_lock.sql','0004_verified_source.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url),'utf8'));
  const wrapper = {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results:sqlite.prepare(sql).all(...args) }; },
        async run() { return sqlite.prepare(sql).run(...args); },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map(x => x.run())); },
  };
  return wrapper;
}
const env = () => ({ DB:database(), APP_PASSWORD:'test-only-password-1234', SESSION_SECRET:'test-only-session-key-with-more-than-32-characters' });
const request = (path, method='GET', body, cookie) => new Request(`https://radar.test/api/${path}`, { method, headers: { origin:'https://radar.test', ...(cookie ? {cookie} : {}) }, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
async function login(environment) {
  const response = await worker.fetch(request('login','POST',{password:environment.APP_PASSWORD}), environment);
  assert.equal(response.status,200);
  return response.headers.get('set-cookie').split(';')[0];
}
test('strict geography and remote filters reject LATAM, worldwide, hybrid and office', () => {
  assert.equal(eligibility(base).eligible,true);
  for (const location of ['Remote - LATAM','Worldwide','São Paulo, Brasil (Hybrid)','United States','Brazil - On-site']) assert.equal(eligibility({...base,location,workplace:''}).eligible,false,location);
  assert.equal(eligibility({...base,location:'Brazil',workplace:'remote'}).eligible,true);
  assert.equal(eligibility({...base,workplace:'hybrid'}).eligible,false);
});
test('scoring is explainable and does not confuse Java and JavaScript', () => {
  const result = assess(base,profile);
  assert.equal(result.score,100); assert.equal(result.compatible,true);
  assert.deepEqual(result.skillMatches,['React','Node.js']);
  assert.equal(assess({...base,description:'JavaScript'}, {...profile,skills:['Java']}).compatible,false);
});
test('senior roles, excluded terms and wrong contracts do not pass profile', () => {
  assert.equal(assess({...base,title:'Senior Full-stack Developer'},profile).compatible,false);
  assert.equal(assess(base,{...profile,exclude:['React']}).compatible,false);
  assert.equal(assess(base,{...profile,contracts:['PJ']}).compatible,false);
  assert.equal(assess({...base,description:'React and Node.js'},profile).compatible,true);
  assert.deepEqual(contracts({...base,description:'Full-time React'}),[]);
});
test('no fabricated score for empty profile; salary remains explicitly unverified', () => {
  assert.equal(assess(base,{...profile,roles:[],skills:[]}).score,null);
  assert.match(assess(base,{...profile,minSalary:5000}).salaryNote,/não verificado/);
});
test('profile validation rejects unbounded input and unsupported contracts', () => {
  assert.deepEqual(validateProfile(profile),profile);
  assert.throws(() => validateProfile({...profile,skills:['x'.repeat(81)]}));
  assert.throws(() => validateProfile({...profile,contracts:['full-time']}));
});
test('sources cannot trigger arbitrary network requests; job links require ATS domains', () => {
  assert.throws(() => sourceURL({...source,slug:'../../internal'}));
  assert.throws(() => sourceURL({...source,provider:'custom'}));
  assert.equal(safeJobURL('https://jobs.lever.co/abc/1','lever'),true);
  for (const url of ['javascript:alert(1)','https://jobs.lever.co.evil.com/1','https://user:pass@jobs.lever.co/1']) assert.equal(safeJobURL(url,'lever'),false);
});
test('Greenhouse updated_at is not presented as first publication', () => {
  assert.equal(normalize('greenhouse',{id:1,title:'Job',location:{name:'Brazil'},content:'x',absolute_url:'https://boards.greenhouse.io/test/1',updated_at:'2026-01-01'},source).published,null);
});
test('missing secrets fail closed; unauthenticated API and foreign-origin writes fail', async () => {
  const environment = env();
  assert.equal((await worker.fetch(request('jobs'),{...environment,APP_PASSWORD:''})).status,503);
  assert.equal((await worker.fetch(request('jobs'),environment)).status,401);
  const evil = new Request('https://radar.test/api/login',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'});
  assert.equal((await worker.fetch(evil,environment)).status,403);
});
test('private login, tampered cookie, profile persistence and logout', async () => {
  const environment = env(); const cookie = await login(environment);
  const result = await worker.fetch(request('profile','GET',undefined,cookie),environment);
  assert.equal(result.status,200);
  assert.equal((await result.json()).skills.includes('TypeScript'),true);
  assert.equal((await worker.fetch(request('profile','GET',undefined,cookie+'invalid'),environment)).status,401);
  const update = await worker.fetch(request('profile','PUT',profile,cookie),environment);
  assert.equal(update.status,200);
  const read = await worker.fetch(request('profile','GET',undefined,cookie),environment);
  assert.deepEqual(await read.json(),profile);
  const logout = await worker.fetch(request('logout','POST',{},cookie),environment);
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
test('login limits are enforced with persistent counters', async () => {
  const environment = env();
  for (let i=0;i<10;i++) assert.equal((await worker.fetch(request('login','POST',{password:'wrong'}),environment)).status,401);
  assert.equal((await worker.fetch(request('login','POST',{password:environment.APP_PASSWORD}),environment)).status,429);
});
const lever = id => ({id,text:'Full-stack Developer',categories:{location:'Brazil'},workplaceType:'remote',descriptionPlain:'React Node.js',createdAt:1700000000000,hostedUrl:`https://jobs.lever.co/cloudwalk/${id}`});
test('import deduplicates, preserves discovery, marks closed and keeps favorites', async () => {
  const environment = env();
  const fetcher = async () => Response.json([lever('a'),lever('b'),{...lever('us'),categories:{location:'USA'}}]);
  assert.equal((await syncSource(environment,source,fetcher)).count,2);
  const original = await environment.DB.prepare("SELECT first_seen FROM jobs WHERE id='lever:cloudwalk:a'").first();
  const cookie = await login(environment);
  assert.equal((await worker.fetch(request('saved','PUT',{id:'lever:cloudwalk:b',status:'saved'},cookie),environment)).status,200);
  await syncSource(environment,source,async () => Response.json([lever('a')]));
  const jobs = await environment.DB.prepare('SELECT * FROM jobs').all();
  assert.equal(jobs.results.length,2);
  assert.equal(jobs.results.find(x => x.id.endsWith(':a')).first_seen,original.first_seen);
  assert.equal(jobs.results.find(x => x.id.endsWith(':b')).active,0);
  const response = await worker.fetch(request('jobs','GET',undefined,cookie),environment);
  assert.equal((await response.json()).jobs.find(x => x.id.endsWith(':b')).status,'saved');
});
test('failed fetch does not mark existing jobs closed; failure is exposed', async () => {
  const environment = env();
  await syncSource(environment,source,async () => Response.json([lever('a')]));
  const result = await syncSource(environment,source,async () => new Response('Rate limited',{status:429}));
  assert.equal(result.ok,false);
  assert.equal((await environment.DB.prepare('SELECT active FROM jobs').first()).active,1);
  assert.match((await environment.DB.prepare('SELECT error FROM sources WHERE id=2').first()).error,/429/);
});
test('unsafe links abort import and saved state accepts existing jobs only', async () => {
  const environment = env();
  const result = await syncSource(environment,source,async () => Response.json([{...lever('a'),hostedUrl:'https://evil.test/'}]));
  assert.equal(result.ok,false);
  const cookie = await login(environment);
  assert.equal((await worker.fetch(request('saved','PUT',{id:'missing',status:'saved'},cookie),environment)).status,404);
});
