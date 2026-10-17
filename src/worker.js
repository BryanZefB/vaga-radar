import { assess, eligibility, normalize, sourceURL, safeJobURL, validateProfile } from './domain.js';
import { linkedInCards, indeedCards, linkedInDetail, indeedDetail, discoveryQuery, publicSearchURL, publicDetailURL } from './public-sources.js';
import { normalizeGupy, normalizeIssue, gupyQueries, gupyURL, issueURL } from './brazil-sources.js';

const encoder = new TextEncoder();
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const stamp = () => new Date().toISOString();
async function readProfile(env){
  const profile=JSON.parse((await env.DB.prepare('SELECT profile FROM settings WHERE id=1').first()).profile);
  return {...profile,experienceYears:profile.experienceYears??2};
}
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function same(a, b) {
  const aa = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(a)));
  const bb = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(b)));
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function authenticated(request, env) {
  const token = /(?:^|;\s*)session=([^;]+)/.exec(request.headers.get('cookie') || '')?.[1];
  if (!token) return false;
  const [expiry, signature] = token.split('.');
  if (!/^\d+$/.test(expiry) || Number(expiry) <= Date.now() || Number(expiry) > Date.now() + 8 * 86400000) return false;
  return same(signature || '', await sign(`session:${expiry}`, env.SESSION_SECRET));
}
async function body(request) {
  if (Number(request.headers.get('content-length') || 0) > 16000) throw new Error('Requisição muito grande.');
  const text = await request.text();
  if (text.length > 16000) throw new Error('Requisição muito grande.');
  return JSON.parse(text);
}
function cookie(request, value, maxAge) {
  return `session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function syncSource(env, source, fetcher = fetch, searchQuery='') {
  const time = stamp();
  try {
    await env.DB.prepare('UPDATE sources SET last_attempt=? WHERE id=?').bind(time,source.id).run();
    const read = async (url, html=false) => {
      const response = await fetcher(url, { headers: { accept: html?'text/html':'application/json', 'user-agent': 'VagaRadar-Personal/1.0' }, signal: AbortSignal.timeout(10000) });
      if(response.status===403) throw new Error('Fonte bloqueou o acesso público (HTTP 403). Consulte a busca externa.');
      if(response.status===429) throw new Error('Fonte limitou as consultas (HTTP 429). Aguarde a próxima rodada.');
      if (!response.ok) throw new Error(`A fonte respondeu HTTP ${response.status}. Confira o identificador da empresa.`);
      const text=await response.text();
      if(text.length>(!html&&source.provider==='greenhouse'?4000000:3000000)) throw new Error('Fonte excedeu o limite de tamanho seguro.');
      return html?text:JSON.parse(text);
    };
    const publicBoard=['linkedin','indeed'].includes(source.provider);
    const partialBoard=publicBoard||['gupy','github'].includes(source.provider);
    let records, warning=null;
    if(source.provider==='gupy'){
      const profile=await readProfile(env);const terms=gupyQueries(profile,searchQuery);const found=[];
      for(const term of terms){
        const data=await read(gupyURL(term));
        if(!Array.isArray(data.data))throw new Error('Formato público da Gupy mudou.');
        found.push(...data.data);
      }
      records=[...new Map(found.map(raw=>[String(raw.id),normalizeGupy(raw)])).values()];
      warning=`Busca parcial Gupy: ${terms.join(', ')}. Até 50 resultados por termo; ausências não significam encerramento.`;
    }else if(source.provider==='github'){
      const data=await read(sourceURL(source));
      if(!Array.isArray(data))throw new Error('Formato público da comunidade mudou.');
      records=data.filter(raw=>!raw.pull_request&&raw.state==='open'&&Number.isFinite(Date.parse(raw.created_at))&&Date.now()-Date.parse(raw.created_at)<=90*86400000).map(normalizeIssue);
      warning='Publicações abertas da comunidade, com até 90 dias. O autor e a empresa não são verificados pelo sistema.';
    }else if(publicBoard){
      const profile=await readProfile(env);
      const html=await read(publicSearchURL(source.provider,discoveryQuery(profile)),true);
      const cards=(source.provider==='linkedin'?linkedInCards:indeedCards)(html);
      if(!cards.length && !/no results|nenhum resultado|nao encontramos|no matching jobs|we couldn.t find/i.test(html)) throw new Error('Formato público indisponível ou acesso limitado. Abra a busca externa para consultar diretamente.');
      records=[];let failed=0;
      const candidates=[...new Map(cards.map(card=>[card.id,card])).values()].filter(card=>!assess({...card,description:''},profile).levelConflict).slice(0,10);
      for(const card of candidates){
        try{
          const detail=await read(publicDetailURL(source.provider,card.id),true);
          if(/no longer accepting applications|no longer available|nao aceita mais candidaturas|não aceita mais candidaturas/i.test(plainPublic(detail))) continue;
          records.push((source.provider==='linkedin'?linkedInDetail:indeedDetail)(detail,card));
        }catch(error){if(/HTTP (?:403|429)/.test(error.message))throw error;failed++;}
      }
      if(failed && !records.length) throw new Error('Descrições públicas inacessíveis. A fonte pode exigir login ou limitar consultas. Nenhum bloqueio foi contornado.');
      warning=`Busca parcial: até 10 descrições por consulta; ${failed} inacessível(is). Não representa todas as vagas do portal.`;
    }else{
      const data = await read(sourceURL(source));
      records = source.provider === 'lever' ? data : data.jobs;
    }
    if (!Array.isArray(records)) throw new Error('Formato de resposta inesperado.');
    if (source.provider === 'lever') {
      if (records.length > 100) throw new Error('Formato de paginação inesperado na fonte Lever.');
      let page = records;
      while (page.length === 100) {
        const url = new URL(sourceURL(source));
        url.searchParams.set('skip', String(records.length));
        page = await read(url.toString());
        if (!Array.isArray(page) || page.length > 100) throw new Error('Formato de paginação inesperado na fonte Lever.');
        records = records.concat(page);
        if (records.length > 500) throw new Error('Fonte Lever excede 500 anúncios; coleta suspensa para proteger a cota gratuita.');
      }
    }
    if (records.length > 1500) throw new Error('Fonte excede o limite de 1.500 anúncios; escolha uma fonte menor.');
    const jobs = records.filter(record=>plausibleRecord(record)).map(record => normalize(source.provider, record, source)).filter(job => eligibility(job).eligible);
    if (jobs.length > 200) throw new Error('Fonte com mais de 200 vagas elegíveis. Coleta suspensa para proteger a cota gratuita.');
    if (jobs.some(job => !job.title || !safeJobURL(job.url, source.provider) || job.id.endsWith(':undefined'))) throw new Error('A fonte retornou anúncio sem identificação ou link oficial reconhecido.');
    const statements = jobs.map(job => jobStatement(env,job,time));
    // D1 limits batch sizes: mark closed only after every import batch succeeds.
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    const completion=[env.DB.prepare('UPDATE sources SET last_sync=?,error=NULL,warning=? WHERE id=?').bind(time,warning,source.id)];
    if(!partialBoard) completion.push(env.DB.prepare('UPDATE jobs SET active=0 WHERE source_id=? AND last_seen<>?').bind(source.id,time));
    await env.DB.batch(completion);
    return { id: source.id, ok: true, count: jobs.length };
  } catch (error) {
    const detail = String(error.message);
    const message = /HTTP|Formato|Fonte|fonte|anúncio/.test(detail) ? detail.slice(0,250) : 'Conexão à API indisponível. Verifique o acesso de rede ao provedor e tente novamente.';
    await env.DB.prepare('UPDATE sources SET error=? WHERE id=?').bind(message, source.id).run();
    return { id: source.id, ok: false, error: message };
  }
}
const plainPublic=value=>String(value).replace(/<[^>]*>/g,' ');
function plausibleRecord(raw){
  const facts=eligibility({title:raw.title||raw.text||'',location:typeof raw.location==='string'?raw.location:raw.location?.name||raw.categories?.location||'',country:raw.country,workplace:raw.workplace||raw.workplaceType||'',description:''});
  if(facts.remote&&facts.brazil)return true;
  const text=[raw.content,raw.description,raw.descriptionPlain,raw.additional,raw.additionalPlain,JSON.stringify(raw.lists||[])].filter(Boolean).join(' ');
  return (facts.remote||/remot|home office|anywhere|telecommute/i.test(text))&&(facts.brazil||/resid|contrata/i.test(text));
}
function jobStatement(env,job,time){
  return env.DB.prepare(`INSERT INTO jobs(id,source_id,title,company,location,description,url,workplace,published,first_seen,last_seen,active,details,check_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,'listed')
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,company=excluded.company,location=excluded.location,description=excluded.description,url=excluded.url,workplace=excluded.workplace,published=excluded.published,last_seen=excluded.last_seen,active=1,details=excluded.details,check_status='listed'`).bind(job.id,job.source_id,job.title,job.company,job.location,job.description,job.url,job.workplace,job.published||null,time,time,JSON.stringify(job.details||{}));
}
export async function verifyJob(env,id,fetcher=fetch){
  const job=await env.DB.prepare('SELECT jobs.*,sources.provider,sources.slug FROM jobs JOIN sources ON sources.id=jobs.source_id WHERE jobs.id=?').bind(id).first();
  if(!job) return {ok:false,error:'Vaga não encontrada.'};
  if(job.checked_at && Date.now()-Date.parse(job.checked_at)<300000) return {ok:true,cached:true};
  const externalId=job.id.split(':').pop();
  const source={id:job.source_id,provider:job.provider,slug:job.slug,company:job.company};
  const publicBoard=['linkedin','indeed'].includes(job.provider);
  const url=job.provider==='gupy'?gupyURL(job.title):job.provider==='github'?issueURL(job.slug,externalId):publicBoard?publicDetailURL(job.provider,externalId):job.provider==='lever'?`https://api.lever.co/v0/postings/${encodeURIComponent(job.slug)}/${encodeURIComponent(externalId)}?mode=json`:`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(job.slug)}/jobs/${encodeURIComponent(externalId)}?content=true`;
  const time=stamp();
  try{
    const response=await fetcher(url,{headers:{'user-agent':'VagaRadar-Personal/1.0'},signal:AbortSignal.timeout(10000)});
    if(job.provider!=='gupy'&&[404,410].includes(response.status)){
      await env.DB.prepare("UPDATE jobs SET active=0,checked_at=?,check_status='closed' WHERE id=?").bind(time,id).run();
      return {ok:true,status:'closed'};
    }
    if(!response.ok) throw new Error('Fonte indisponível.');
    let raw;
    if(job.provider==='gupy'){
      const data=await response.json();
      const found=data.data?.find(item=>String(item.id)===externalId);
      if(!found)throw new Error('Busca parcial não localizou o anúncio; não confirma encerramento.');
      raw=normalizeGupy(found);
    }else if(job.provider==='github'){
      const issue=await response.json();
      if(issue.state==='closed'){
        await env.DB.prepare("UPDATE jobs SET active=0,checked_at=?,check_status='closed' WHERE id=?").bind(time,id).run();
        return {ok:true,status:'closed'};
      }
      if(issue.pull_request||issue.state!=='open')throw new Error('Publicação de comunidade inválida.');
      raw=normalizeIssue(issue);
    }else if(publicBoard){
      const html=await response.text();
      if(/no longer accepting applications|no longer available|não aceita mais candidaturas/i.test(plainPublic(html))){
        await env.DB.prepare("UPDATE jobs SET active=0,checked_at=?,check_status='closed' WHERE id=?").bind(time,id).run();
        return {ok:true,status:'closed'};
      }
      raw=(job.provider==='linkedin'?linkedInDetail:indeedDetail)(html,{id:externalId,title:job.title,company:job.company,location:job.location,published:job.published});
    }else raw=await response.json();
    const normalized=normalize(job.provider,raw,source);
    if(normalized.id!==job.id||!normalized.title||!normalized.description||!safeJobURL(normalized.url,job.provider)) throw new Error('Dados inconsistentes.');
    await jobStatement(env,normalized,time).run();
    const rules=eligibility(normalized);const status=rules.eligible?'confirmed':rules.expired?'expired':'ineligible';
    await env.DB.prepare('UPDATE jobs SET active=?,checked_at=?,check_status=? WHERE id=?').bind(rules.eligible?1:0,time,status,id).run();
    return {ok:true,status};
  }catch{
    await env.DB.prepare("UPDATE jobs SET checked_at=?,check_status='unconfirmed' WHERE id=?").bind(time,id).run();
    return {ok:false,error:'Não foi possível reconfirmar esta vaga. O provedor pode estar indisponível ou exigir login.'};
  }
}
export async function runSearch(env,query,fetcher=fetch){
  const key=query.trim().toLowerCase().replace(/\s+/g,' ');const now=Date.now();
  const cached=await env.DB.prepare('SELECT requested_at FROM search_requests WHERE query=?').bind(key).first();
  if(cached&&now-cached.requested_at<15*60000)return {ok:true,cached:true,results:[]};
  const latest=await env.DB.prepare('SELECT MAX(requested_at) AS last FROM search_requests').first();
  if(latest?.last&&now-latest.last<60000)return {ok:false,error:'Aguarde um minuto entre buscas novas.'};
  const lease=now+600000;
  const lock=await env.DB.prepare('UPDATE sync_lock SET until_ms=? WHERE id=1 AND until_ms<? RETURNING id').bind(lease,now).first();
  if(!lock)return {ok:false,error:'Já existe uma coleta em andamento. Aguarde.'};
  try{
    const source=await env.DB.prepare("SELECT * FROM sources WHERE provider='gupy' AND enabled=1").first();
    if(!source)return {ok:false,error:'Ative a fonte Gupy para buscar vagas novas.'};
    await env.DB.prepare('INSERT INTO search_requests(query,requested_at) VALUES(?,?) ON CONFLICT(query) DO UPDATE SET requested_at=excluded.requested_at').bind(key,now).run();
    const results=[await syncSource(env,source,fetcher,query)];
    const communities=(await env.DB.prepare("SELECT * FROM sources WHERE provider='github' AND enabled=1 ORDER BY id").all()).results;
    for(const community of communities){if(!community.last_attempt||now-Date.parse(community.last_attempt)>=110*60000)results.push(await syncSource(env,community,fetcher));}
    await env.DB.prepare('DELETE FROM search_requests WHERE requested_at<?').bind(now-86400000).run();
    return {ok:results.some(result=>result.ok),cached:false,results};
  }finally{await env.DB.prepare('UPDATE sync_lock SET until_ms=0 WHERE id=1 AND until_ms=?').bind(lease).run();}
}
async function syncAll(env, force = false) {
  const lease = Date.now() + 600000;
  const lock = await env.DB.prepare('UPDATE sync_lock SET until_ms=? WHERE id=1 AND until_ms<? RETURNING id').bind(lease, Date.now()).first();
  if (!lock) return [{ ok:false, error:'Já existe uma coleta em andamento. Aguarde.' }];
  try {
  const { results } = await env.DB.prepare('SELECT * FROM sources WHERE enabled=1 ORDER BY COALESCE(last_attempt,\'\'),id').all();
  const outputs = [];
  for (const source of results) {
    if (!force && source.last_attempt && Date.now() - Date.parse(source.last_attempt) < 110 * 60000) continue;
    if(outputs.length>=5) break;
    outputs.push(await syncSource(env, source));
  }
  await env.DB.prepare('DELETE FROM login_limits WHERE bucket < ?').bind(String(Math.floor(Date.now() / 900000) - 4)).run();
  await env.DB.prepare("DELETE FROM jobs WHERE active=0 AND last_seen < datetime('now','-90 days') AND id NOT IN (SELECT job_id FROM saved)").run();
  return outputs;
  } finally { await env.DB.prepare('UPDATE sync_lock SET until_ms=0 WHERE id=1 AND until_ms=?').bind(lease).run(); }
}
async function api(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!env.APP_PASSWORD || !env.SESSION_SECRET || env.APP_PASSWORD.length < 12 || env.SESSION_SECRET.length < 32) return json({ error: 'Acesso privado não configurado. Configure APP_PASSWORD (12+ caracteres) e SESSION_SECRET (32+) no Worker.' }, 503);
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return json({ error: 'Origem não permitida.' }, 403);
  if (path === '/api/login' && request.method === 'POST') {
    const payload = await body(request);
    // Global durable limit is appropriate for this single-user application.
    const bucket = String(Math.floor(Date.now() / 900000));
    const row = await env.DB.prepare('INSERT INTO login_limits(bucket,attempts) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket).first();
    if (row.attempts > 10) return json({ error: 'Limite de tentativas atingido. Tente novamente em até 15 minutos.' }, 429);
    if (!await same(String(payload.password || ''), env.APP_PASSWORD)) return json({ error: 'Senha incorreta.' }, 401);
    const expiry = String(Date.now() + 7 * 86400000);
    return json({ ok: true }, 200, { 'set-cookie': cookie(request, `${expiry}.${await sign(`session:${expiry}`, env.SESSION_SECRET)}`, 604800) });
  }
  if (!await authenticated(request, env)) return json({ error: 'Entre com sua senha para continuar.' }, 401);
  if (path === '/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(request, '', 0) });
  if (path === '/api/profile' && request.method === 'GET') return json(await readProfile(env));
  if (path === '/api/profile' && request.method === 'PUT') {
    const previous=await readProfile(env);
    const profile = validateProfile({...previous,...await body(request)});
    await env.DB.prepare('UPDATE settings SET profile=? WHERE id=1').bind(JSON.stringify(profile)).run();
    if(discoveryQuery(previous)!==discoveryQuery(profile))await env.DB.prepare("UPDATE sources SET last_attempt=NULL WHERE provider IN ('linkedin','indeed')").run();
    return json(profile);
  }
  if(path==='/api/verify' && request.method==='POST'){
    const {id}=await body(request);
    if(typeof id!=='string'||id.length>250) throw new Error('Identificador inválido.');
    const result=await verifyJob(env,id);
    return json(result,result.ok?200:502);
  }
  if(path==='/api/search'&&request.method==='POST'){
    const {query=''}=await body(request);
    if(typeof query!=='string'||query.length>80)throw new Error('Busca inválida: use até 80 caracteres.');
    const result=await runSearch(env,query);
    return json(result,result.ok?200:409);
  }
  if (path === '/api/jobs' && request.method === 'GET') {
    const profile = await readProfile(env);
    const { results } = await env.DB.prepare('SELECT jobs.*,saved.status,sources.provider,sources.slug,sources.enabled AS source_enabled,sources.error AS source_error,sources.last_sync AS source_sync FROM jobs LEFT JOIN saved ON saved.job_id=jobs.id JOIN sources ON sources.id=jobs.source_id ORDER BY first_seen DESC LIMIT 3000').all();
    return json({ jobs: results.map(job => assess(job, profile)), limit: 3000 });
  }
  if (path === '/api/sources' && request.method === 'GET') {
    const profile=await readProfile(env);
    return json((await env.DB.prepare('SELECT * FROM sources ORDER BY id').all()).results.map(source=>({...source,searchUrl:source.provider==='gupy'?'https://portal.gupy.io/job-search/jobs':source.provider==='github'?`https://github.com/${source.slug}/issues`:source.provider==='linkedin'?publicSearchURL(source.provider,discoveryQuery(profile)).replace('/jobs-guest/jobs/api/seeMoreJobPostings/search','/jobs/search'):source.provider==='indeed'?publicSearchURL(source.provider,discoveryQuery(profile)):source.provider==='lever'?`https://jobs.lever.co/${source.slug}`:`https://job-boards.greenhouse.io/${source.slug}`})));
  }
  if (path === '/api/sources' && request.method === 'POST') {
    const source = await body(request);
    sourceURL(source);
    if (typeof source.company !== 'string' || !source.company.trim() || source.company.length > 100) throw new Error('Informe o nome da empresa.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sources').first();
    if (count.n >= 16) throw new Error('Limite pessoal de 16 fontes.');
    await env.DB.prepare('INSERT INTO sources(provider,slug,company) VALUES(?,?,?)').bind(source.provider, source.slug, source.company.trim()).run();
    return json({ ok: true });
  }
  if (/^\/api\/sources\/\d+$/.test(path) && request.method === 'PATCH') {
    const { enabled } = await body(request);
    await env.DB.prepare('UPDATE sources SET enabled=? WHERE id=?').bind(enabled ? 1 : 0, Number(path.split('/').pop())).run();
    return json({ ok: true });
  }
  if (path === '/api/sync' && request.method === 'POST') {
    // Per-source cadence prevents repeated imports from consuming free quotas.
    return json({ results: await syncAll(env) });
  }
  if (path === '/api/saved' && request.method === 'PUT') {
    const { id, status } = await body(request);
    if (!['saved','applied','hidden',null].includes(status) || typeof id !== 'string') throw new Error('Estado inválido.');
    if (!await env.DB.prepare('SELECT id FROM jobs WHERE id=?').bind(id).first()) return json({ error: 'Vaga não encontrada.' }, 404);
    if (status === null) await env.DB.prepare('DELETE FROM saved WHERE job_id=?').bind(id).run();
    else await env.DB.prepare('INSERT INTO saved(job_id,status,updated) VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,updated=excluded.updated').bind(id, status, stamp()).run();
    return json({ ok: true });
  }
  return json({ error: 'Rota não encontrada.' }, 404);
}
export default {
  async fetch(request, env, ctx) {
    let response;
    try {
      response = new URL(request.url).pathname.startsWith('/api/') ? await api(request, env, ctx) : await env.ASSETS.fetch(request);
    } catch (error) {
      // Do not expose database errors, secrets or stack traces.
      const known = /inválid|Selecione|Informe|Limite pessoal|grande|Provedor|Perfil/.test(error.message);
      response = json({ error: known ? error.message : 'Não foi possível concluir a operação. Confira a configuração e tente novamente.' }, known ? 400 : 500);
    }
    const headers = new Headers(response.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(controller, env, ctx) { ctx.waitUntil(syncAll(env)); },
};
