import test from 'node:test';
import assert from 'node:assert/strict';
import { plain, eligibility, assess } from '../src/domain.js';
import { linkedInCards, linkedInDetail, indeedCards, indeedDetail, jsonAssignment, discoveryQuery, publicSearchURL, publicDetailURL } from '../src/public-sources.js';
import { filterJobs, hasSalary } from '../public/filters.js';

test('full descriptions preserve paragraphs, decode encoded tags and never retain scripts',()=>{
  assert.equal(plain('&lt;p&gt;Requisitos&lt;/p&gt;&lt;ul&gt;&lt;li&gt;React &amp;amp; Node&lt;/li&gt;&lt;/ul&gt;'),'Requisitos\n\nReact & Node');
  assert.equal(plain('<script>alert(1)</script><p>Texto</p>'),'Texto');
  assert.equal(plain('a'.repeat(50000)).length,50000);
});
test('Brazil city/state and explicit remote models pass; ambiguous and hybrid postings fail',()=>{
  const job={title:'Desenvolvedor',location:'Florianópolis/SC',description:'Modelo de trabalho: 100% remoto',workplace:''};
  assert.equal(eligibility(job).eligible,true);
  assert.equal(eligibility({...job,location:'LATAM'}).eligible,false);
  assert.equal(eligibility({...job,description:'Modelo de trabalho: Híbrido / Remoto'}).eligible,false);
  assert.equal(eligibility({...job,description:'Equipe internacional com colegas remotos'}).eligible,false);
});
test('LinkedIn guest cards and complete public description are parsed as data only',()=>{
  const cards=linkedInCards('<li><div data-entity-urn="urn:li:jobPosting:123"><h3 class="base-search-card__title">Developer React</h3><h4 class="base-search-card__subtitle">Empresa</h4><span class="job-search-card__location">Brazil (Remote)</span><time datetime="2026-10-10"></time></div></li>');
  assert.equal(cards.length,1);assert.equal(cards[0].id,'123');
  const job=linkedInDetail('<h2 class="top-card-layout__title">Developer React</h2><a class="topcard__org-name-link">Empresa</a><div class="show-more-less-html__markup"><p>React</p><div>Requisitos completos</div></div>',cards[0]);
  assert.match(job.description,/Requisitos completos/);assert.equal(eligibility(job).eligible,true);
  assert.throws(()=>linkedInDetail('<form>Sign in</form>',cards[0]));
});
test('Indeed structured data provides full description, country, remote and salary',()=>{
  const data={metaData:{mosaicProviderJobCardsModel:{results:[{jobkey:'1234567890abcdef',title:'React Developer',company:'Empresa',formattedLocation:'Remoto'}]}}};
  const card=indeedCards('window.mosaic.providerData["mosaic-provider-jobcards"]='+JSON.stringify(data)+';')[0];
  const job=indeedDetail('<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:'React Developer',description:'<p>React</p><p>Texto completo</p>',applicantLocationRequirements:{'@type':'Country',name:'Brazil'},jobLocationType:'TELECOMMUTE',baseSalary:{currency:'BRL',value:{minValue:5000,maxValue:7000,unitText:'MONTH'}}})+'</script>',card);
  assert.equal(eligibility(job).eligible,true);assert.equal(hasSalary(job.details.salary),true);assert.match(job.description,/Texto completo/);
  assert.throws(()=>indeedDetail('<form>Captcha</form>',card));
});
test('public parsers reject changed/challenge formats without executing page code',()=>{
  assert.throws(()=>indeedCards('<html>Verify you are human</html>'));
  const parsed=jsonAssignment('let x={"text":"} with escaped \\" quote","n":{"x":1}}; throw "do not execute";','let x=');
  assert.equal(parsed.n.x,1);
  assert.throws(()=>publicDetailURL('indeed','../../secret'));
  assert.throws(()=>publicDetailURL('linkedin','https://other.test'));
});
test('public searches are restricted to Brazil/remote and do not include contact data',()=>{
  const query=discoveryQuery({focusSkills:['Node.js','NodeJS','React','React.js']});
  assert.equal(query,'Node.js OR React');
  assert.equal(new URL(publicSearchURL('linkedin',query)).searchParams.get('f_WT'),'2');
  assert.equal(new URL(publicSearchURL('indeed',query)).hostname,'br.indeed.com');
});
test('explicit experience minimum excludes unsuitable roles but company age does not',()=>{
  const profile={roles:['developer'],skills:['React'],focusSkills:['React'],levels:['pleno'],exclude:[],contracts:['CLT'],experienceYears:2};
  const job={title:'React Developer',description:'Minimum 5 years of professional experience. React.',location:'Brazil remote'};
  assert.equal(assess(job,profile).experienceConflict,true);assert.equal(assess(job,profile).compatible,false);
  assert.equal(assess({...job,description:'A company with 30 years of history. React.'},profile).experienceConflict,false);
});
test('advanced filters distinguish publication, discovery, salary and verification',()=>{
  const now=Date.parse('2026-10-17T12:00:00Z');
  const first={id:'1',title:'React Developer',company:'A',description:'React TypeScript',provider:'indeed',titleLevel:'junior',kinds:['CLT'],score:80,compatible:true,first_seen:'2026-10-17T10:00:00Z',published:null,details:{},verification:{status:'listed'}};
  const second={...first,id:'2',provider:'lever',company:'B',titleLevel:'pleno',published:'2026-10-17T08:00:00Z',status:'saved',details:{salary:{min:5000}},verification:{status:'confirmed'}};
  const jobs=[first,second];
  assert.deepEqual(filterJobs(jobs,{published:'1'},now).map(x=>x.id),['2']);
  assert.deepEqual(filterJobs(jobs,{published:'unknown'},now).map(x=>x.id),['1']);
  assert.deepEqual(filterJobs(jobs,{salary:true,provider:'lever',level:'pleno',status:'saved',verification:'confirmed'},now).map(x=>x.id),['2']);
  assert.equal(filterJobs(jobs,{skills:'React, Python'},now).length,0);
  assert.equal(hasSalary({currency:'BRL'}),false);
});
