import { assess, eligibility, normalize, sourceURL, safeJobURL, validateProfile } from './domain.js';

const encoder = new TextEncoder();
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const stamp = () => new Date().toISOString();
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
export async function syncSource(env, source, fetcher = fetch) {
  const time = stamp();
  try {
    const response = await fetcher(sourceURL(source), { headers: { accept: 'application/json', 'user-agent': 'VagaRadar-Personal/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`A fonte respondeu HTTP ${response.status}. Confira o identificador da empresa.`);
    const data = await response.json();
    const records = source.provider === 'lever' ? data : data.jobs;
    if (!Array.isArray(records)) throw new Error('Formato de resposta inesperado.');
    if (records.length > 1500) throw new Error('Fonte excede o limite de 1.500 anúncios; escolha uma fonte menor.');
    const jobs = records.map(record => normalize(source.provider, record, source)).filter(job => eligibility(job).eligible);
    if (jobs.length > 150) throw new Error('Fonte com mais de 150 vagas elegíveis. Coleta suspensa para proteger a cota gratuita.');
    if (jobs.some(job => !job.title || !safeJobURL(job.url, source.provider) || job.id.endsWith(':undefined'))) throw new Error('A fonte retornou anúncio sem identificação ou link oficial reconhecido.');
    const statements = jobs.map(job => env.DB.prepare(`INSERT INTO jobs(id,source_id,title,company,location,description,url,workplace,published,first_seen,last_seen,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,company=excluded.company,location=excluded.location,description=excluded.description,url=excluded.url,workplace=excluded.workplace,published=excluded.published,last_seen=excluded.last_seen,active=1`).bind(job.id, source.id, job.title, job.company, job.location, job.description, job.url, job.workplace, job.published, time, time));
    // D1 limits batch sizes: mark closed only after every import batch succeeds.
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    await env.DB.batch([
      env.DB.prepare('UPDATE jobs SET active=0 WHERE source_id=? AND last_seen<>?').bind(source.id, time),
      env.DB.prepare('UPDATE sources SET last_sync=?,error=NULL WHERE id=?').bind(time, source.id),
    ]);
    return { id: source.id, ok: true, count: jobs.length };
  } catch (error) {
    const detail = String(error.message);
    const message = /HTTP|Formato|Fonte|fonte|anúncio/.test(detail) ? detail.slice(0,250) : 'Conexão à API indisponível. Verifique o acesso de rede ao provedor e tente novamente.';
    await env.DB.prepare('UPDATE sources SET error=? WHERE id=?').bind(message, source.id).run();
    return { id: source.id, ok: false, error: message };
  }
}
async function syncAll(env, force = false) {
  const lease = Date.now() + 300000;
  const lock = await env.DB.prepare('UPDATE sync_lock SET until_ms=? WHERE id=1 AND until_ms<? RETURNING id').bind(lease, Date.now()).first();
  if (!lock) return [{ ok:false, error:'Já existe uma coleta em andamento. Aguarde.' }];
  try {
  const { results } = await env.DB.prepare('SELECT * FROM sources WHERE enabled=1 ORDER BY id LIMIT 8').all();
  const outputs = [];
  for (const source of results) {
    if (!force && source.last_sync && Date.now() - Date.parse(source.last_sync) < 110 * 60000) continue;
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
  if (path === '/api/profile' && request.method === 'GET') return json(JSON.parse((await env.DB.prepare('SELECT profile FROM settings WHERE id=1').first()).profile));
  if (path === '/api/profile' && request.method === 'PUT') {
    const profile = validateProfile(await body(request));
    await env.DB.prepare('UPDATE settings SET profile=? WHERE id=1').bind(JSON.stringify(profile)).run();
    return json(profile);
  }
  if (path === '/api/jobs' && request.method === 'GET') {
    const profile = JSON.parse((await env.DB.prepare('SELECT profile FROM settings WHERE id=1').first()).profile);
    const { results } = await env.DB.prepare('SELECT jobs.*,saved.status,sources.enabled AS source_enabled,sources.error AS source_error,sources.last_sync AS source_sync FROM jobs LEFT JOIN saved ON saved.job_id=jobs.id JOIN sources ON sources.id=jobs.source_id ORDER BY first_seen DESC LIMIT 2000').all();
    return json({ jobs: results.map(job => assess(job, profile)), limit: 2000 });
  }
  if (path === '/api/sources' && request.method === 'GET') return json((await env.DB.prepare('SELECT * FROM sources ORDER BY id').all()).results);
  if (path === '/api/sources' && request.method === 'POST') {
    const source = await body(request);
    sourceURL(source);
    if (typeof source.company !== 'string' || !source.company.trim() || source.company.length > 100) throw new Error('Informe o nome da empresa.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sources').first();
    if (count.n >= 8) throw new Error('Limite pessoal de 8 fontes. Desative ou substitua fontes existentes.');
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
