const $ = id => document.getElementById(id);
const state = { jobs: [], sources: [], profile: null, view: 'radar', mode: 'matches' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : 'Não informada';
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
  document.querySelectorAll('[name="contracts"]').forEach(input => input.checked = profile.contracts.includes(input.value));
  render(); renderSources();
}
function visibleJobs() { return state.jobs.filter(job => job.active && job.source_enabled && job.source_sync && Date.now() - Date.parse(job.source_sync) < 6 * 3600000 && !job.source_error && job.eligibility.eligible && job.status !== 'hidden'); }
function card(job) {
  const reasons = [...(job.roleMatches.length ? [`Cargo: ${job.roleMatches.slice(0,2).join(', ')}`] : []), ...job.skillMatches.slice(0,5)];
  let safe = false;
  try { const url = new URL(job.url); safe = url.protocol === 'https:' && !url.username && !url.password; } catch {}
  return `<article class="job-card ${job.active ? '' : 'closed'}"><div class="job-top"><div class="company-icon">${escape(job.company.slice(0,2).toUpperCase())}</div><div class="job-company"><strong>${escape(job.company)}</strong><span>Brasil · Remoto</span></div><span class="match ${job.score >= 65 ? 'high' : ''}">${job.score === null ? 'Configure o perfil' : `${job.score}% de aderência`}</span></div><h2>${escape(job.title)}</h2><div class="badges"><span>↗ Remoto</span><span>${escape(job.kinds.join(' / ') || 'Contratação não informada')}</span>${job.status === 'applied' ? '<span class="applied">Candidatura marcada</span>' : ''}${!job.active ? '<span>Encerrada na fonte</span>' : ''}</div><p class="job-description">${escape(job.description.slice(0,240))}${job.description.length > 240 ? '…' : ''}</p><div class="reasons">${reasons.length ? reasons.map(reason => `<span>${escape(reason)}</span>`).join('') : '<span>Sem termos de perfil encontrados</span>'}</div><details><summary>Por que esta vaga aparece?</summary><p>Localização na fonte: ${escape(job.location)}. ${job.compatible ? 'Passou pelos filtros do perfil.' : 'Não passou por todos os filtros do perfil.'} A pontuação usa cargo, habilidades e nível; não avalia anos exigidos ou inglês.</p>${job.focusMatches?.length ? `<p>Stack principal: ${escape(job.focusMatches.join(', '))}.</p>` : ''}${job.titleSkillGaps?.length ? `<p>O título menciona tecnologias fora das habilidades cadastradas: ${escape(job.titleSkillGaps.join(', '))}.</p>` : ''}${job.levelConflict ? '<p>O título indica senioridade acima dos níveis selecionados.</p>' : ''}${job.source_error || !job.source_enabled || Date.now() - Date.parse(job.source_sync) >= 6 * 3600000 ? '<p>Fonte pausada, com falha ou sem coleta recente. A disponibilidade precisa ser reconfirmada.</p>' : ''}${job.excluded.length ? `<p>Termos excluídos: ${escape(job.excluded.join(', '))}.</p>` : ''}<p>Nível: ${escape(job.levelMatches.join(', ') || 'Sem correspondência explícita; confira os requisitos')}.</p>${job.salaryNote ? `<p>${escape(job.salaryNote)}</p>` : ''}${job.kinds.includes('Estágio') ? '<p>Estágio pode exigir matrícula ativa. Sua formação informada está concluída.</p>' : ''}<p>Publicação informada: ${escape(date(job.published))}<br>Primeira coleta: ${escape(date(job.first_seen))}<br>Última presença na fonte: ${escape(date(job.last_seen))}</p><p>Confira o anúncio antes de se candidatar. A coleta não valida a identidade de recrutadores que entram em contato com você.</p></details><div class="job-bottom"><span class="small">Encontrada ${escape(date(job.first_seen))}</span><div><button class="icon-button" data-save="${escape(job.id)}" data-status="${job.status === 'saved' ? '' : 'saved'}" aria-label="${job.status === 'saved' ? 'Remover dos salvos' : 'Salvar vaga'}">${job.status === 'saved' ? '★' : '☆'}</button><button class="text-button" data-save="${escape(job.id)}" data-status="${job.status === 'applied' ? '' : 'applied'}">${job.status === 'applied' ? 'Desmarcar' : 'Me candidatei'}</button>${safe ? `<a class="apply" href="${escape(job.url)}" target="_blank" rel="noopener noreferrer">Ver na fonte ↗</a>` : ''}</div></div></article>`;
}
function empty(title, message) { return `<div class="empty"><span>◎</span><h2>${title}</h2><p>${message}</p><button class="text-button" data-open-sources>Gerenciar fontes ↗</button></div>`; }
function render() {
  const all = visibleJobs();
  $('stat-total').textContent = all.length;
  $('stat-match').textContent = all.filter(job => job.compatible).length;
  $('stat-new').textContent = all.filter(job => Date.now() - Date.parse(job.first_seen) <= 7 * 86400000).length;
  const query = $('search').value.toLowerCase();
  const contract = $('contract').value;
  let jobs = all.filter(job => (state.mode === 'all' || job.compatible) && `${job.title} ${job.company} ${job.description}`.toLowerCase().includes(query) && (!contract || (contract === 'unknown' ? !job.kinds.length : job.kinds.includes(contract))));
  jobs.sort((a,b) => $('sort').value === 'score' ? (b.score || 0) - (a.score || 0) || b.first_seen.localeCompare(a.first_seen) : b.first_seen.localeCompare(a.first_seen));
  $('result-count').textContent = `${jobs.length} oportunidade${jobs.length === 1 ? '' : 's'}`;
  const failure = state.sources.some(source => source.error);
  $('jobs').innerHTML = jobs.map(card).join('') || empty('Seu próximo passo ainda está no radar.', failure ? 'Há fontes com falha. Veja o diagnóstico em Fontes de vagas. Nenhuma vaga demonstrativa é exibida como real.' : 'Atualize as fontes ou ajuste os filtros. Vagas sem Brasil e trabalho remoto explícitos ficam fora.');
  $('saved-jobs').innerHTML = state.jobs.filter(job => ['saved','applied'].includes(job.status)).map(card).join('') || empty('Sua seleção começa aqui.', 'Salve uma vaga no radar para acompanhar por aqui.');
}
function renderSources() {
  $('sources').innerHTML = state.sources.map(source => `<article class="source"><div><h3>${escape(source.company)}</h3><span class="small">${escape(source.provider)} / ${escape(source.slug)}</span><p class="${source.error ? 'error' : 'small'}">${escape(source.error || (source.last_sync ? `Última coleta bem-sucedida: ${date(source.last_sync)}` : 'Aguardando primeira coleta · fonte ainda não confirmada'))}</p></div><button class="secondary" data-source="${source.id}" data-enabled="${source.enabled ? '0' : '1'}">${source.enabled ? 'Pausar' : 'Ativar'}</button></article>`).join('');
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
  const nav = event.target.closest('[data-view]'); if (nav) view(nav.dataset.view);
  if (event.target.closest('[data-open-sources]')) view('sources');
  const tab = event.target.closest('[data-mode]');
  if (tab) { state.mode = tab.dataset.mode; document.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('active', el === tab)); render(); }
  const save = event.target.closest('[data-save]');
  if (save) { save.disabled = true; try { await api('saved', {method:'PUT',body:{id:save.dataset.save,status:save.dataset.status || null}}); state.jobs.find(job => job.id === save.dataset.save).status = save.dataset.status || null; render(); } catch (error) { toast(error.message); save.disabled = false; } }
  const source = event.target.closest('[data-source]');
  if (source) { try { await api(`sources/${source.dataset.source}`, {method:'PATCH',body:{enabled:source.dataset.enabled === '1'}}); await load(); } catch (error) { toast(error.message); } }
});
for (const id of ['search','contract','sort']) $(id).addEventListener(id === 'search' ? 'input' : 'change', render);
$('sync').addEventListener('click', async () => {
  $('sync').disabled = true; $('sync').textContent = '↻ Consultando fontes…';
  try { const result = await api('sync', {method:'POST',body:{}}); await load(); toast(result.results.length ? `${result.results.filter(x => x.ok).length} fonte(s) atualizada(s). ${result.results.filter(x => !x.ok).length} com falha.` : 'Fontes já consultadas recentemente. Intervalo mínimo: 110 minutos.'); }
  catch (error) { toast(error.message); } finally { $('sync').disabled = false; $('sync').textContent = '↻ Atualizar fontes'; }
});
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const profile = {};
  for (const field of ['roles','skills','levels','exclude','focusSkills']) profile[field] = $(field).value.split(',').map(x => x.trim()).filter(Boolean);
  profile.contracts = [...document.querySelectorAll('[name="contracts"]:checked')].map(x => x.value);
  profile.minSalary = Number($('minSalary').value);
  try { await api('profile', {method:'PUT',body:profile}); await load(); toast('Perfil salvo. Aderência recalculada.'); } catch (error) { toast(error.message); }
});
$('source-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('sources', {method:'POST',body:{company:$('company').value,provider:$('provider').value,slug:$('slug').value}}); event.target.reset(); await load(); toast('Fonte adicionada. Clique em Atualizar fontes para consultar.'); } catch (error) { toast(error.message); }
});
load().catch(error => { if (!error.message.includes('Entre com')) $('login-error').textContent = error.message; });
