import { filterJobs, providerName, hasSalary } from '/filters.js';
const $ = id => document.getElementById(id);
const state = { jobs: [], sources: [], profile: null, view: 'radar', mode: 'matches' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => !value || !Number.isFinite(Date.parse(value)) ? 'Não informada' : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value+'T12:00:00-03:00' : value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo' });
let timer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(timer); timer = setTimeout(() => $('toast').hidden = true, 6500); }
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { ...options, headers: { 'content-type': 'application/json' }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await response.json();
  if (response.status === 401) { $('app').hidden = true; $('login-screen').hidden = false; }
  if (!response.ok) throw new Error(data.error || 'Erro ao conectar.');
  return data;
}
async function load() {
  const [profile, jobs, sources] = await Promise.all([api('profile'), api('jobs'), api('sources')]);
  Object.assign(state, { profile, jobs: jobs.jobs, sources });
  $('app').hidden = false; $('login-screen').hidden = true;
  for (const field of ['roles','skills','levels','exclude','focusSkills']) $(field).value = (profile[field] || []).join(', ');
  $('minSalary').value = profile.minSalary;
  $('experienceYears').value = profile.experienceYears ?? 2;
  document.querySelectorAll('[name="contracts"]').forEach(input => input.checked = profile.contracts.includes(input.value));
  const companyValue=$('company-filter').value;
  $('company-filter').innerHTML='<option value="">Todas as empresas</option>'+[...new Set(state.jobs.map(job=>job.company))].sort().map(company=>`<option value="${escape(company)}">${escape(company)}</option>`).join('');
  $('company-filter').value=companyValue;
  render(); renderSources();
}
function visibleJobs() { return state.jobs.filter(job => job.active && job.source_enabled && job.last_seen && Date.now()-Date.parse(job.last_seen)<6*3600000 && !job.source_error && job.eligibility.eligible && job.status !== 'hidden'); }
const verificationLabel = job => ({confirmed:'Reconfirmada na fonte',listed:'Listada na fonte',unconfirmed:'Precisa reconfirmação',closed:'Encerrada na fonte',ineligible:'País/modalidade não confirmados'}[job.verification?.status]||'Precisa reconfirmação');
function safeLink(value){ try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;} }
function card(job) {
  const reasons=[...(job.roleMatches.length?[`Cargo: ${job.roleMatches.slice(0,2).join(', ')}`]:[]),...job.skillMatches.slice(0,5)];
  return `<article class="job-card ${job.active?'':'closed'}"><div class="job-top"><div class="company-icon">${escape(job.company.slice(0,2).toUpperCase())}</div><div class="job-company"><strong>${escape(job.company)}</strong><span>${escape(providerName(job.provider))} · ${escape(job.location)}</span></div><span class="match ${job.compatible?'high':''}">${job.score===null?'Configure o perfil':`${job.score}% de aderência`}</span></div>
    <h2>${escape(job.title)}</h2><div class="badges"><span>${job.eligibility.eligible?'Remoto · Brasil':'País/modalidade não confirmados'}</span><span>${escape(job.kinds.join(' / ')||'Contratação não informada')}</span><span>${escape(verificationLabel(job))}</span>${hasSalary(job.details?.salary)?'<span>Faixa salarial informada</span>':''}${job.status==='applied'?'<span class="applied">Candidatura marcada</span>':''}</div>
    <p class="job-description">${escape(job.description.slice(0,240))}${job.description.length>240?'…':''}</p><div class="reasons">${reasons.map(reason=>`<span>${escape(reason)}</span>`).join('')||'<span>Sem termos de perfil encontrados</span>'}</div>
    <button class="details-button secondary" data-detail="${escape(job.id)}">Descrição completa e todas as informações ↗</button>
    <div class="job-bottom"><span class="small">Publicação: ${escape(date(job.published))}<br>Coleta: ${escape(date(job.last_seen))}</span><div><button class="icon-button" data-save="${escape(job.id)}" data-status="${job.status==='saved'?'':'saved'}" aria-label="${job.status==='saved'?'Remover dos salvos':'Salvar vaga'}">${job.status==='saved'?'★':'☆'}</button><button class="text-button" data-save="${escape(job.id)}" data-status="${job.status==='applied'?'':'applied'}">${job.status==='applied'?'Desmarcar':'Me candidatei'}</button>${safeLink(job.url)?`<a class="apply" href="${escape(job.url)}" target="_blank" rel="noopener noreferrer">Ver na fonte ↗</a>`:''}</div></div></article>`;
}
function showDetail(id){
  const job=state.jobs.find(item=>item.id===id);if(!job)return;
  const details=job.details||{};
  const field=(name,value)=>`<div><dt>${name}</dt><dd>${escape(value||'Não informado pela fonte')}</dd></div>`;
  $('job-detail').innerHTML=`<span class="eyebrow">INFORMAÇÕES DO ANÚNCIO</span><h1 id="job-dialog-title">${escape(job.title)}</h1><p>${escape(job.company)} · ${escape(providerName(job.provider))}</p>
    <section class="verification-panel"><strong>${escape(verificationLabel(job))}</strong><p>Última listagem: ${escape(date(job.last_seen))}<br>Consulta individual: ${escape(date(job.checked_at))}</p><p>Confirmamos a presença do anúncio na fonte, não a identidade de quem entra em contato nem a ausência de fraude. Confira a empresa e nunca pague para participar.</p><button class="secondary" data-verify="${escape(job.id)}">Consultar novamente na fonte</button></section>
    <dl class="job-facts">${field('Localização original',job.location)}${field('País',job.eligibility.brazil?'Brasil explicitado na origem':'Não confirmado')}${field('Modalidade',job.eligibility.remote?'Remoto declarado na origem':'Não confirmada')}${field('Contratação',job.kinds.join(' / '))}${field('Tipo original',details.employmentType)}${field('Nível indicado no título',({junior:'Júnior',pleno:'Pleno',senior:'Sênior / liderança',estagio:'Estágio'})[job.titleLevel])}${field('Departamento',(details.departments||[]).join(', ')||details.department)}${field('Experiência mínima explícita',job.minimumExperienceYears===null?null:`${job.minimumExperienceYears} anos`)}${field('Publicação',date(job.published))}${field('Primeira descoberta',date(job.first_seen))}${field('Prazo de candidatura',date(details.deadline))}${field('Idioma declarado',details.language)}${field('Pontuação de aderência',job.score===null?'Perfil não configurado':`${job.score}%`)}</dl>
    <h2>Salário e remuneração</h2><pre class="source-data">${escape(hasSalary(details.salary)?JSON.stringify(details.salary,null,2):'Salário não informado de forma estruturada pela fonte. Confira também a descrição abaixo.')}</pre>
    <h2>Aderência ao seu perfil</h2><p>${job.compatible?'Passou pelos filtros cadastrados.':'Não passou por todos os filtros cadastrados.'} Pontuação por palavras-chave; não confirma todos os requisitos. ${job.experienceConflict?'O mínimo de experiência explícito supera o seu perfil.':''}</p><ul><li>Stack principal encontrada: ${escape(job.focusMatches?.join(', ')||'nenhuma')}</li><li>Habilidades encontradas: ${escape(job.skillMatches.join(', ')||'nenhuma')}</li><li>Termos excluídos: ${escape(job.excluded.join(', ')||'nenhum')}</li><li>Tecnologias no título fora do perfil: ${escape(job.titleSkillGaps?.join(', ')||'nenhuma detectada')}</li><li>Conflito de senioridade: ${job.levelConflict?'sim':'não detectado'}</li></ul>
    <h2>Evidências de Brasil e trabalho remoto</h2><p>${escape(job.eligibility.brazilEvidence||'Brasil não confirmado')}<br>${escape(job.eligibility.remoteEvidence||'Remoto não confirmado')}</p>
    ${job.kinds.includes('Estágio')?'<p class="footnote">Sua formação está concluída. Confira se esta vaga exige matrícula ativa.</p>':''}
    <h2>Descrição completa disponibilizada pela fonte</h2><div class="full-description">${escape(job.description||'A descrição não está disponível. Consulte a publicação original.')}</div>
    <details class="raw-details"><summary>Todos os dados complementares disponibilizados</summary><pre class="source-data">${escape(JSON.stringify(details,null,2))}</pre></details>
    <p class="small">Horários de Brasília. Campos não fornecidos não são estimados. Publicação e primeira descoberta são datas diferentes.</p>
    ${safeLink(job.url)?`<a class="apply" href="${escape(job.url)}" target="_blank" rel="noopener noreferrer">Abrir anúncio original ↗</a><p class="original-url">${escape(job.url)}</p>`:''}`;
  if(!$('job-dialog').open)$('job-dialog').showModal();
}
function empty(title, message) { return `<div class="empty"><span>◎</span><h2>${title}</h2><p>${message}</p><button class="text-button" data-open-sources>Gerenciar fontes ↗</button></div>`; }
function render() {
  const all = visibleJobs();
  $('stat-total').textContent = all.length;
  $('stat-match').textContent = all.filter(job => job.compatible).length;
  $('stat-new').textContent = all.filter(job => Date.now() - Date.parse(job.first_seen) <= 7 * 86400000).length;
  const jobs=filterJobs(all,{mode:state.mode,query:$('search').value,contract:$('contract').value,sort:$('sort').value,company:$('company-filter').value,provider:$('provider-filter').value,level:$('level-filter').value,score:$('score-filter').value,published:$('published-filter').value,discovered:$('discovered-filter').value,status:$('status-filter').value,language:$('language-filter').value,skills:$('skills-filter').value,salary:$('salary-filter').checked,verification:$('verification-filter').value});
  $('result-count').textContent = `${jobs.length} oportunidade${jobs.length === 1 ? '' : 's'}`;
  const failure = state.sources.some(source => source.error);
  $('jobs').innerHTML = jobs.map(card).join('') || empty('Seu próximo passo ainda está no radar.', failure ? 'Há fontes com falha. Veja o diagnóstico em Fontes de vagas. Nenhuma vaga demonstrativa é exibida como real.' : 'Nenhuma vaga passou pelos filtros atuais. Consulte Todas no radar ou ajuste a busca. País, remoto e dados não informados não são presumidos.');
  $('saved-jobs').innerHTML = state.jobs.filter(job => ['saved','applied'].includes(job.status)).map(card).join('') || empty('Sua seleção começa aqui.', 'Salve uma vaga no radar para acompanhar por aqui.');
}
function renderSources() {
  $('sources').innerHTML=state.sources.map(source=>`<article class="source"><div><h3>${escape(source.company)}</h3><span class="small">${escape(providerName(source.provider))} / ${escape(source.slug)}</span><p class="${source.error?'error':'small'}">${escape(source.error||(source.last_sync?`Última coleta: ${date(source.last_sync)}`:'Aguardando primeira coleta'))}</p>${source.warning?`<p class="small">${escape(source.warning)}</p>`:''}${safeLink(source.searchUrl)?`<a href="${escape(source.searchUrl)}" class="text-button" target="_blank" rel="noopener noreferrer">Abrir busca/página original ↗</a>`:''}</div><button class="secondary" data-source="${source.id}" data-enabled="${source.enabled?'0':'1'}">${source.enabled?'Pausar':'Ativar'}</button></article>`).join('');
}
function view(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach(element => element.hidden = element.id !== `view-${name}`);
  document.querySelectorAll('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === name));
  $('breadcrumb').textContent = `Seu espaço / ${{radar:'Radar de vagas',saved:'Minha seleção',profile:'Meu perfil',sources:'Fontes de vagas'}[name]}`;
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $('login-error').textContent = '';
  try { await api('login', { method:'POST', body:{ password:$('password').value } }); $('password').value = ''; await load(); }
  catch (error) { $('login-error').textContent = error.message; } finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await api('logout', {method:'POST',body:{}}); location.reload(); } catch (error) { toast(error.message); } });
document.addEventListener('click', async event => {
  const detail=event.target.closest('[data-detail]');if(detail)showDetail(detail.dataset.detail);
  const verify=event.target.closest('[data-verify]');
  if(verify){verify.disabled=true;verify.textContent='Consultando…';try{const result=await api('verify',{method:'POST',body:{id:verify.dataset.verify}});await load();showDetail(verify.dataset.verify);toast(result.cached?'Consulta recente: veja o estado e horário registrados.':result.status==='confirmed'?'Anúncio reconfirmado na fonte.':'Estado do anúncio atualizado; confira os detalhes.');}catch(error){toast(error.message);await load();showDetail(verify.dataset.verify);}}
  const nav = event.target.closest('[data-view]'); if (nav) view(nav.dataset.view);
  if (event.target.closest('[data-open-sources]')) view('sources');
  const tab = event.target.closest('[data-mode]');
  if (tab) { state.mode = tab.dataset.mode; document.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('active', el === tab)); render(); }
  const save = event.target.closest('[data-save]');
  if (save) { save.disabled = true; try { await api('saved', {method:'PUT',body:{id:save.dataset.save,status:save.dataset.status || null}}); state.jobs.find(job => job.id === save.dataset.save).status = save.dataset.status || null; render(); } catch (error) { toast(error.message); save.disabled = false; } }
  const source = event.target.closest('[data-source]');
  if (source) { try { await api(`sources/${source.dataset.source}`, {method:'PATCH',body:{enabled:source.dataset.enabled === '1'}}); await load(); } catch (error) { toast(error.message); } }
});
const filterIds=['search','contract','sort','company-filter','provider-filter','level-filter','score-filter','published-filter','discovered-filter','status-filter','language-filter','skills-filter','salary-filter','verification-filter'];
for(const id of filterIds)$(id).addEventListener(['search','skills-filter'].includes(id)?'input':'change',render);
$('clear-filters').addEventListener('click',()=>{for(const id of filterIds){const input=$(id);if(input.type==='checkbox')input.checked=false;else if(input.tagName==='SELECT')input.selectedIndex=0;else input.value='';}render();});
$('close-dialog').addEventListener('click',()=>$('job-dialog').close());
$('sync').addEventListener('click', async () => {
  $('sync').disabled = true; $('sync').textContent = '↻ Consultando fontes…';
  try { const result = await api('sync', {method:'POST',body:{}}); await load(); toast(result.results.length ? `${result.results.filter(x => x.ok).length} fonte(s) atualizada(s). ${result.results.filter(x => !x.ok).length} com falha.` : 'Fontes já consultadas recentemente. O rodízio consulta até 5 fontes; aguarde a próxima rodada. Intervalo por fonte: 110 minutos.'); }
  catch (error) { toast(error.message); } finally { $('sync').disabled = false; $('sync').textContent = '↻ Atualizar fontes'; }
});
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const profile = {};
  for (const field of ['roles','skills','levels','exclude','focusSkills']) profile[field] = $(field).value.split(',').map(x => x.trim()).filter(Boolean);
  profile.contracts = [...document.querySelectorAll('[name="contracts"]:checked')].map(x => x.value);
  profile.minSalary = Number($('minSalary').value);
  profile.experienceYears=Number($('experienceYears').value);
  try { await api('profile', {method:'PUT',body:profile}); await load(); toast('Perfil salvo. Aderência recalculada.'); } catch (error) { toast(error.message); }
});
$('source-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('sources', {method:'POST',body:{company:$('company').value,provider:$('provider').value,slug:$('slug').value}}); event.target.reset(); await load(); toast('Fonte adicionada. Clique em Atualizar fontes para consultar.'); } catch (error) { toast(error.message); }
});
load().catch(error => { if (!error.message.includes('Entre com')) $('login-error').textContent = error.message; });
