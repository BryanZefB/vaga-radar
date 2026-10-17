import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker, { syncSource, verifyJob, runSearch } from '../src/worker.js';
import { assess, contracts, eligibility, normalize, sourceURL, safeJobURL, validateProfile } from '../src/domain.js';

import { normalizeGupy, normalizeIssue, gupyQueries, issueURL } from '../src/brazil-sources.js';

const profile = { roles:['developer','full-stack'], skills:['React','Node.js'], levels:['pleno','junior'], exclude:[], contracts:['CLT','PJ','Estágio'], minSalary:0 };
const base = { id:'test', title:'Full-stack Developer Pleno', company:'Empresa teste', location:'Remote - Brazil', description:'React and Node.js. CLT.', workplace:'remote', url:'https://jobs.lever.co/test/1' };
const source = { id:2, provider:'lever', slug:'cloudwalk', company:'CloudWalk' };
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url),'utf8'));
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
  assert.equal(assess({...base,title:'Backend Software Engineering Manager'}, {...profile,roles:['backend']}).compatible,false);
  assert.equal(assess({...base,title:'Master Full-stack Developer'},profile).compatible,false);
  assert.equal(assess(base,{...profile,exclude:['React']}).compatible,false);
  assert.equal(assess(base,{...profile,contracts:['PJ']}).compatible,false);
  assert.equal(assess({...base,description:'React and Node.js'},profile).compatible,true);
  assert.deepEqual(contracts({...base,description:'Full-time React'}),[]);
});
test('main stack gate rejects Java/Angular roles matching shared infrastructure only', () => {
  const focused={...profile,skills:['React','AWS'],focusSkills:['React','Node.js']};
  assert.equal(assess({...base,description:'Java, Angular and AWS'},focused).compatible,false);
  assert.equal(assess({...base,description:'React and AWS'},focused).compatible,true);
  assert.equal(assess({...base,title:'Mid-level Java Angular Developer',description:'Java and Angular. Node.js is a plus. AWS.'},focused).compatible,false);
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
  const existingProfile=await result.json();
  assert.equal(existingProfile.skills.includes('TypeScript'),true);
  assert.equal((await worker.fetch(request('profile','GET',undefined,cookie+'invalid'),environment)).status,401);
  const update = await worker.fetch(request('profile','PUT',profile,cookie),environment);
  assert.equal(update.status,200);
  const read = await worker.fetch(request('profile','GET',undefined,cookie),environment);
  assert.deepEqual(await read.json(),{...profile,focusSkills:existingProfile.focusSkills,experienceYears:existingProfile.experienceYears});
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
test('Lever pagination imports all pages before determining closed postings', async () => {
  const environment = env();
  const calls=[];
  const result=await syncSource(environment,source,async url => {
    const skip=Number(new URL(url).searchParams.get('skip'));
    calls.push(skip);
    return Response.json(skip===0 ? Array.from({length:100},(_,i)=>lever(String(i))) : [lever('last')]);
  });
  assert.equal(result.ok,true);
  assert.equal(result.count,101);
  assert.deepEqual(calls,[0,100]);
});
test('unsafe links abort import and saved state accepts existing jobs only', async () => {
  const environment = env();
  const result = await syncSource(environment,source,async () => Response.json([{...lever('a'),hostedUrl:'https://evil.test/'}]));
  assert.equal(result.ok,false);
  const cookie = await login(environment);
  assert.equal((await worker.fetch(request('saved','PUT',{id:'missing',status:'saved'},cookie),environment)).status,404);
});
test('individual confirmation refreshes complete details and closed/unavailable are distinct',async()=>{
  const environment=env();
  await syncSource(environment,source,async()=>Response.json([lever('a'),lever('b'),lever('c')]));
  assert.equal((await verifyJob(environment,'lever:cloudwalk:a',async()=>Response.json({...lever('a'),descriptionPlain:'React\n'+ 'long description '.repeat(4000)}))).status,'confirmed');
  const first=await environment.DB.prepare("SELECT * FROM jobs WHERE id='lever:cloudwalk:a'").first();
  assert.ok(first.description.length>40000);assert.equal(first.check_status,'confirmed');
  assert.equal((await verifyJob(environment,'lever:cloudwalk:b',async()=>new Response('',{status:404}))).status,'closed');
  assert.equal((await environment.DB.prepare("SELECT active FROM jobs WHERE id='lever:cloudwalk:b'").first()).active,0);
  assert.equal((await verifyJob(environment,'lever:cloudwalk:c',async()=>new Response('',{status:429}))).ok,false);
  const unavailable=await environment.DB.prepare("SELECT * FROM jobs WHERE id='lever:cloudwalk:c'").first();
  assert.equal(unavailable.active,1);assert.equal(unavailable.check_status,'unconfirmed');
});
test('an individual country/model mismatch is flagged without claiming the job is closed',async()=>{
  const environment=env();
  await syncSource(environment,source,async()=>Response.json([lever('a')]));
  assert.equal((await verifyJob(environment,'lever:cloudwalk:a',async()=>Response.json({...lever('a'),categories:{location:'USA'}}))).status,'ineligible');
  const job=await environment.DB.prepare('SELECT * FROM jobs').first();
  assert.equal(job.active,0);assert.equal(job.check_status,'ineligible');
});
test('partial LinkedIn searches never close postings merely absent from the next search',async()=>{
  const environment=env();
  const linked=await environment.DB.prepare("SELECT * FROM sources WHERE provider='linkedin'").first();
  const card=id=>`<li><div data-entity-urn="urn:li:jobPosting:${id}"><h3 class="base-search-card__title">React Developer</h3><h4 class="base-search-card__subtitle">Empresa teste</h4><span class="job-search-card__location">Remote Brazil</span></div></li>`;
  let listing=card('123')+card('456');
  const fetcher=async url=>new Response(url.includes('seeMoreJobPostings')?listing:'<h2 class="top-card-layout__title">React Developer</h2><div class="show-more-less-html__markup">React Node.js. Trabalho remoto.</div>');
  assert.equal((await syncSource(environment,linked,fetcher)).count,2);
  listing=card('123');
  assert.equal((await syncSource(environment,linked,fetcher)).count,1);
  assert.equal((await environment.DB.prepare('SELECT COUNT(*) AS n FROM jobs WHERE active=1').first()).n,2);
});
test('source-provider migration preserves existing vacancies and their favorites',()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')&&x<'0007').sort())db.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  db.exec("INSERT INTO jobs(id,source_id,title,company,location,description,url,workplace,first_seen,last_seen) VALUES('existing',2,'React','Company','Brazil','React','https://jobs.lever.co/cloudwalk/1','remote','2026-10-01','2026-10-01'); INSERT INTO saved VALUES('existing','saved','2026-10-01');");
  db.exec('BEGIN;'+readFileSync(new URL('../migrations/0007_sources_and_details.sql',import.meta.url),'utf8')+'COMMIT;');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs JOIN sources ON sources.id=jobs.source_id').get().n,1);
  assert.equal(db.prepare('SELECT status FROM saved').get().status,'saved');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('public collection stops immediately when a detail request is rate limited',async()=>{
  const environment=env();const linked=await environment.DB.prepare("SELECT * FROM sources WHERE provider='linkedin'").first();
  const card=id=>`<li><div data-entity-urn="urn:li:jobPosting:${id}"><h3 class="base-search-card__title">React Developer</h3><span class="job-search-card__location">Remote Brazil</span></div></li>`;
  let requests=0;
  const result=await syncSource(environment,linked,async url=>{requests++;return url.includes('seeMoreJobPostings')?new Response(card('123')+card('456')):new Response('',{status:429});});
  assert.equal(result.ok,false);assert.equal(requests,2);assert.match(result.error,/429/);
});

const gupyJob = id => ({id,name:'Desenvolvedor React Pleno',careerPageName:'Empresa teste',state:'RS',workplaceType:'remote',description:'React Node.js. CLT.',publishedDate:'2026-10-01',jobUrl:`https://teste.gupy.io/jobs/${id}`});
test('Gupy requires Brazilian evidence, preserves full descriptions and rejects expired deadlines',()=>{
  const job=normalizeGupy({...gupyJob(1),description:'React\n'+ 'descrição completa '.repeat(3000)});
  assert.equal(eligibility(job).eligible,true);assert.ok(job.description.length>40000);
  assert.equal(eligibility(normalizeGupy({...gupyJob(1),state:'',description:'React'})).eligible,false);
  const clt=normalizeGupy({...gupyJob(1),state:''});
  assert.equal(eligibility(clt).eligible,true);assert.match(clt.details.brazilBasis,/CLT/);
  assert.equal(eligibility(normalizeGupy({...gupyJob(1),applicationDeadline:'2020-01-01'})).expired,true);
  assert.deepEqual(gupyQueries({focusSkills:['Node.js','React','NestJS','AWS']}),['Node','React','NestJS']);
});
test('community sections keep location, company and instructions without fabricating employers',()=>{
  const raw={number:123,title:'[Remoto] Desenvolvedor React na Empresa Exemplo',body:'## Nossa empresa\nEmpresa Exemplo\n## Local\nRemoto - Porto Alegre / RS\n## Requisitos\nReact e Node.js. CLT.\n## Como se candidatar\nEnviar currículo no link da empresa.',created_at:new Date().toISOString(),state:'open',html_url:'https://github.com/frontendbr/vagas/issues/123',user:{login:'autor'}};
  const issue=normalizeIssue(raw);
  assert.match(issue.location,/Porto Alegre/);assert.equal(issue.company,'Empresa Exemplo');
  assert.match(issue.details.applicationInstructions,/Enviar currículo/);
  assert.equal(issue.details.employerVerified,false);assert.equal(issue.details.publisher,'autor');
  assert.equal(eligibility(issue).eligible,true);
  assert.equal(normalizeIssue({...raw,title:'[Remoto] React',body:'React'}).company,'Empresa não identificada na publicação');
  assert.throws(()=>issueURL('../internal','123'));
  assert.equal(safeJobURL('https://teste.gupy.io/jobs/1','gupy'),true);
  assert.equal(safeJobURL('https://teste.gupy.io.evil.com/jobs/1','gupy'),false);
  assert.equal(safeJobURL(raw.html_url,'github'),true);
});
test('Gupy partial results do not close absent jobs; individual absence remains inconclusive',async()=>{
  const environment=env();const gupy=await environment.DB.prepare("SELECT * FROM sources WHERE provider='gupy'").first();
  assert.equal((await syncSource(environment,gupy,async()=>Response.json({data:[gupyJob(1),gupyJob(2)]})) ).count,2);
  assert.equal((await syncSource(environment,gupy,async()=>Response.json({data:[gupyJob(1)]}))).count,1);
  const id='gupy:brasil-remoto:2';
  assert.equal((await verifyJob(environment,id,async()=>Response.json({data:[]}))).ok,false);
  assert.equal((await environment.DB.prepare('SELECT active FROM jobs WHERE id=?').bind(id).first()).active,1);
});
test('community closure is recognized and stale or pull request entries are never imported',async()=>{
  const environment=env();const github=await environment.DB.prepare("SELECT * FROM sources WHERE provider='github' ORDER BY id LIMIT 1").first();
  const issue={number:123,title:'[Remoto Brasil] Desenvolvedor React Pleno',body:'React Node.js',created_at:new Date().toISOString(),state:'open',html_url:`https://github.com/${github.slug}/issues/123`};
  const result=await syncSource(environment,github,async()=>Response.json([issue,{...issue,number:124,pull_request:{}},{...issue,number:125,created_at:'2020-01-01'}]));
  assert.equal(result.count,1);
  const id=`github:${github.slug}:123`;
  assert.equal((await verifyJob(environment,id,async()=>Response.json({...issue,state:'closed'}))).status,'closed');
  assert.equal((await environment.DB.prepare('SELECT active FROM jobs WHERE id=?').bind(id).first()).active,0);
});
test('new searches use constrained sources, cache identical queries and throttle different queries',async()=>{
  const environment=env();let calls=0;
  const fetcher=async url=>{calls++;assert.ok(url.startsWith('https://portal.gupy.io/')||url.startsWith('https://api.github.com/repos/'));return Response.json(url.includes('gupy')?{data:[gupyJob(1)]}:[]);};
  const first=await runSearch(environment,' React ',fetcher);assert.equal(first.ok,true);assert.equal(calls,4);
  assert.equal((await runSearch(environment,'react',fetcher)).cached,true);assert.equal(calls,4);
  assert.equal((await runSearch(environment,'Node.js',fetcher)).ok,false);assert.equal(calls,4);
  assert.equal((await worker.fetch(request('search','POST',{query:'React'}),environment)).status,401);
});
test('mobile roles do not pass a web-only React profile',()=>{
  const focused={...profile,focusSkills:['React']};
  assert.equal(assess({...base,title:'Desenvolvedor React Native',description:'React Node.js'}, {...focused,roles:['desenvolvedor']}).compatible,false);
});
test('aggregator migration preserves verified jobs, favorites and foreign keys',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')&&x<'0009').sort())db.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  db.exec("INSERT INTO jobs(id,source_id,title,company,location,description,url,workplace,first_seen,last_seen,details,checked_at,check_status) VALUES('existing',2,'React','Company','Brazil','React','https://jobs.lever.co/cloudwalk/1','remote','2026-10-01','2026-10-01','{\"department\":\"Engineering\"}','2026-10-01','confirmed'); INSERT INTO saved VALUES('existing','saved','2026-10-01');");
  db.exec('BEGIN;'+readFileSync(new URL('../migrations/0009_brazilian_aggregators.sql',import.meta.url),'utf8')+'COMMIT;');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs JOIN sources ON sources.id=jobs.source_id').get().n,1);
  assert.equal(db.prepare('SELECT check_status FROM jobs').get().check_status,'confirmed');
  assert.equal(db.prepare('SELECT status FROM saved').get().status,'saved');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
