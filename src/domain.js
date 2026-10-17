export const fold = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function plain(value) {
  let text=String(value||'');
  for(let i=0;i<2;i++) text=text.replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi,(match,numeric,name)=>{
    if(numeric){const n=numeric[0].toLowerCase()==='x'?parseInt(numeric.slice(1),16):Number(numeric);return n>0&&n<=0x10ffff?String.fromCodePoint(n):match;}
    return ({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",ndash:'–',mdash:'—',bull:'•'})[name.toLowerCase()]??match;
  });
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|br|section)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/[\t \r]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
const has = (text, term) => {
  const escaped = fold(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text);
};
export function eligibility(job) {
  const location=fold(job.location), title=fold(job.title), description=fold(job.description);
  const model=/(?:modelo|modalidade|formato|regime|local|work model|workplace|work arrangement|location)\s*(?:de\s*)?(?:trabalho|atuacao)?\s*[:\-]\s*[^\n.]{0,70}/.exec(description)?.[0]||'';
  const remoteWord=/\b(remote|remoto|remota|home office|anywhere|telecommute)\b/;
  const remote=job.workplace==='remote'||remoteWord.test(location)||remoteWord.test(title)||remoteWord.test(model)||/\b(?:100%|fully|fully-|totalmente)\s*(?:remote|remoto|remota)\b/.test(description)||/\b(?:trabalho|vaga|position|role)\s+(?:totalmente\s+|fully\s+)?(?:remot[oa]|remote)\b/.test(description);
  const hybrid=/\b(hybrid|hibrido|hibrida|on.?site|presencial)\b/.test(`${location} ${title} ${model}`)||['hybrid','on-site'].includes(job.workplace)||/\bpresenc(?:a|ial)\s+obrigatoria\b/.test(description)||/\b(?:trabalho|modelo|regime)\s+(?:de trabalho\s+)?hibrid[oa]\b/.test(description)||/\b(?:presencial|on.?site)[^\n.]{0,25}(?:obrigatori[oa]|required|mandatory)\b/.test(description);
  const cityState=/\b(?:sao paulo|rio de janeiro|florianopolis|curitiba|porto alegre|belo horizonte|recife|fortaleza|salvador|brasilia|campinas|joinville|sao jose dos campos)\s*[,/\-]\s*(?:sp|rj|sc|pr|rs|mg|pe|ce|ba|df)\b/.test(location);
  const brazil=/\b(brasil|brazil|br)\b/.test(location)||/\b(brasil|brazil)\b/.test(title)||fold(job.country)==='br'||cityState||/\b(?:residir|residente|residencia|contratacao|contratar)\s+(?:no|em|para o)\s+brasil\b/.test(description);
  const blocked=/\b(?:only|somente|apenas)\s+(?:us|usa|united states|europe|eu)\b/.test(`${location} ${description}`)||/\b(?:nao|not)\s+(?:e\s+|is\s+)?(?:remot[oa]|remote)\b/.test(`${location} ${model}`)||/\bmust[^\n.]{0,20}(?:reside|be based|be located)[^\n.]{0,20}(?:united states|usa|europe)\b/.test(description);
  let details=job.details||{};if(typeof details==='string'){try{details=JSON.parse(details);}catch{details={};}}
  const deadline=details.deadline;
  const deadlineMs=typeof deadline==='string'?Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(deadline)?deadline+'T23:59:59Z':deadline):NaN;
  const expired=Number.isFinite(deadlineMs)&&deadlineMs<Date.now();
  const remoteEvidence=job.workplace==='remote'?'Modalidade remota no campo estruturado':remoteWord.test(location)?`Localização: ${job.location}`:remoteWord.test(title)?`Título: ${job.title}`:model||'Declaração explícita de trabalho totalmente remoto';
  return {eligible:remote&&!hybrid&&brazil&&!blocked&&!expired,remote,brazil,hybrid,blocked,expired,remoteEvidence:remote?remoteEvidence:null,brazilEvidence:brazil?(cityState?`Cidade e UF brasileiras: ${job.location}`:/\b(brasil|brazil|br)\b/.test(location)?`Localização: ${job.location}`:'País BR ou residência no Brasil explicitamente informados'):null};
}
export function contracts(job) {
  const text = fold(`${job.title} ${job.location} ${job.description}`);
  const found = [];
  if (/\bclt\b/.test(text)) found.push('CLT');
  if (/\b(pj|pessoa juridica|contractor|b2b)\b/.test(text)) found.push('PJ');
  if (/\b(estagio|estagiari[oa]|intern|internship)\b/.test(text)) found.push('Estágio');
  return found;
}
export function assess(job, profile) {
  const text = fold(`${job.title} ${job.description}`);
  const title = fold(job.title);
  const roleMatches = profile.roles.filter(term => has(title, term));
  const skillMatches = profile.skills.filter(term => has(text, term));
  const focusMatches = (profile.focusSkills || []).filter(term => has(text, term));
  const titleSkillGaps = (profile.focusSkills || []).length ? ['Java','Angular','Python','Kotlin','Golang','PHP','Ruby','Go','React Native','React-Native','Flutter','Swift','Android','iOS'].filter(term => has(title, term) && !profile.skills.some(skill => fold(skill).replace(/[-. ]/g,'') === fold(term).replace(/[-. ]/g,''))) : [];
  const excluded = profile.exclude.filter(term => has(text, term));
  const levelMatches = profile.levels.filter(term => has(text, term));
  const seniorTitle = /\b(senior|sr|staff|principal|lead|lider|manager|head|director|diretor|diretora|gerente|coordenador|coordenadora|supervisor|supervisora|master|expert|especialista|architect|arquiteto)\b/.test(title);
  const seniorAllowed = profile.levels.some(term => /senior|sênior|staff|principal|lead|lider|manager|head|director|diretor|gerente|coordenador|supervisor|master|expert|especialista|architect|arquiteto|^sr$/i.test(term));
  const levelConflict = profile.levels.length > 0 && seniorTitle && !seniorAllowed;
  const experienceRequirements=[...text.matchAll(/(?:minimum of|minimum|at least|minimo de|minimo|pelo menos)\s*(\d{1,2})\s*\+?\s*(?:years?|anos?)\s*(?:(?:of|de)\s*)?(?:professional\s+|profissional\s+)?(?:experience|experiencia)/g),...text.matchAll(/experiencia\s+(?:minima\s+)?(?:de\s+)?(?:pelo menos\s+|no minimo\s+)?(\d{1,2})\s*\+?\s*anos/g)];
  const minimumExperienceYears=experienceRequirements.length?Math.max(...experienceRequirements.map(m=>Number(m[1]))):null;
  const experienceConflict=Number.isFinite(profile.experienceYears)&&minimumExperienceYears!==null&&minimumExperienceYears>profile.experienceYears;
  const kinds = contracts(job);
  const contractMatch = !kinds.length || kinds.some(kind => profile.contracts.includes(kind));
  const configured = profile.roles.length > 0 || profile.skills.length > 0;
  const roleWeight = profile.roles.length ? 60 : 0;
  const skillWeight = profile.skills.length ? 30 : 0;
  const levelWeight = profile.levels.length ? 10 : 0;
  const denominator = roleWeight + skillWeight + levelWeight;
  const score = !configured ? null : Math.round(100 * ((roleMatches.length ? roleWeight : 0) + (profile.skills.length ? skillWeight * skillMatches.length / profile.skills.length : 0) + (levelMatches.length ? levelWeight : 0)) / denominator);
  let details=job.details||{};
  if(typeof details==='string'){try{details=JSON.parse(details);}catch{details={};}}
  const titleLevel=/\b(?:senior|sr|staff|principal|lead|manager|master|especialista|gerente)\b/.test(title)?'senior':/\b(?:pleno|mid[ -]?level|mid|intermediate)\b/.test(title)?'pleno':/\b(?:junior|jr|entry[ -]?level)\b/.test(title)?'junior':/\b(?:estagio|intern|estagiario)\b/.test(title)?'estagio':'unknown';
  const fresh=job.active && job.source_enabled!==0 && !job.source_error && job.last_seen && Date.now()-Date.parse(job.last_seen)<6*3600000;
  const rules=eligibility(job);
  const verification={status:rules.expired?'expired':job.check_status==='ineligible'?'ineligible':!job.active||job.check_status==='closed'?'closed':!fresh||job.check_status==='unconfirmed'?'unconfirmed':job.check_status==='confirmed'&&job.checked_at&&Date.now()-Date.parse(job.checked_at)<6*3600000?'confirmed':'listed',listedAt:job.last_seen||null,checkedAt:job.checked_at||null};
  return { ...job, details, titleLevel, verification, kinds, score, roleMatches, skillMatches, focusMatches, titleSkillGaps, excluded, levelMatches, contractMatch, minimumExperienceYears, experienceConflict,
    levelConflict,
    compatible: configured && !experienceConflict && titleSkillGaps.length === 0 && (!(profile.focusSkills || []).length || focusMatches.length > 0) && (!profile.roles.length || roleMatches.length > 0) && (!profile.skills.length || skillMatches.length > 0) && !levelConflict && excluded.length === 0 && contractMatch,
    salaryNote: profile.minSalary ? 'Salário mínimo não verificado: confira valor, moeda e período no anúncio.' : null,
    eligibility: rules };
}
export function validateProfile(value) {
  const result = {};
  for (const field of ['roles','skills','exclude','levels','contracts']) {
    if (!Array.isArray(value[field]) || value[field].length > 30 || value[field].some(x => typeof x !== 'string' || !x.trim() || x.length > 80)) throw new Error('Perfil inválido: use listas com até 30 termos de até 80 caracteres.');
    result[field] = [...new Set(value[field].map(x => x.trim()))];
  }
  if (value.focusSkills !== undefined) {
    if (!Array.isArray(value.focusSkills) || value.focusSkills.length > 30 || value.focusSkills.some(x => typeof x !== 'string' || !x.trim() || x.length > 80)) throw new Error('Perfil inválido: tecnologias principais inválidas.');
    result.focusSkills = [...new Set(value.focusSkills.map(x => x.trim()))];
  }
  if (!result.contracts.length || result.contracts.some(x => !['CLT','PJ','Estágio'].includes(x))) throw new Error('Selecione CLT, PJ ou Estágio.');
  result.minSalary = Number(value.minSalary || 0);
  if(value.experienceYears!==undefined){result.experienceYears=Number(value.experienceYears);if(!Number.isFinite(result.experienceYears)||result.experienceYears<0||result.experienceYears>50)throw new Error('Experiência inválida.');}
  if (!Number.isFinite(result.minSalary) || result.minSalary < 0 || result.minSalary > 1000000) throw new Error('Salário inválido.');
  return result;
}
export function normalize(provider, raw, source) {
  if(['linkedin','indeed','gupy','github'].includes(provider)) return {...raw,id:`${provider}:${source.slug}:${raw.id}`,source_id:source.id,details:raw.details||{}};
  if (provider === 'lever') return {
    id: `lever:${source.slug}:${raw.id}`, source_id: source.id, company: source.company,
    title: plain(raw.text), location: plain(raw.categories?.location), workplace: raw.workplaceType || '',
    description: plain([raw.descriptionPlain || raw.description, ...(raw.lists || []).map(x => `${x.text}\n${x.content}`), raw.additionalPlain || raw.additional].join('\n\n')),
    details:{department:raw.categories?.department||raw.categories?.team||null,locations:raw.categories?.allLocations||[],employmentType:raw.categories?.commitment||null,salary:raw.salaryRange||null,sections:(raw.lists||[]).map(x=>({title:plain(x.text),content:plain(x.content)})),applicationUrl:raw.applyUrl||null},
    url: raw.hostedUrl, published: raw.createdAt ? new Date(raw.createdAt).toISOString() : null,
  };
  return {
    id: `greenhouse:${source.slug}:${raw.id}`, source_id: source.id, company: source.company,
    title: plain(raw.title), location: plain(raw.location?.name), workplace: '',
    description: plain(raw.content), url: raw.absolute_url,
    details:{departments:(raw.departments||[]).map(x=>x.name),offices:(raw.offices||[]).map(x=>x.name),metadata:raw.metadata||[],salary:raw.pay_input_ranges||null,deadline:raw.application_deadline||null,updatedAt:raw.updated_at||null,language:raw.language||null},
    // updated_at is not a publication timestamp.
    published: raw.first_published || null,
  };
}
export function sourceURL(source) {
  if(source.provider==='github'){
    if(!/^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/i.test(source.slug||''))throw new Error('Repositório inválido.');
    return `https://api.github.com/repos/${source.slug}/issues?state=open&sort=created&direction=desc&per_page=100`;
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(source.slug)) throw new Error('Identificador de fonte inválido.');
  if (source.provider === 'lever') return `https://api.lever.co/v0/postings/${source.slug}?mode=json&limit=100&skip=0`;
  if (source.provider === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${source.slug}/jobs?content=true`;
  if(source.provider==='gupy'){
    if(source.slug!=='brasil-remoto')throw new Error('Identificador público inválido.');
    return 'https://portal.gupy.io/api/job-search/jobs';
  }
  if (source.provider === 'linkedin' || source.provider === 'indeed') {
    if(source.slug!=='brasil-remoto') throw new Error('Identificador público inválido.');
    return source.provider==='linkedin'?'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search':'https://br.indeed.com/jobs';
  }
  throw new Error('Provedor não permitido.');
}
export function safeJobURL(url, provider) {
  try {
    const parsed = new URL(url);
    if(provider==='gupy')return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&parsed.hostname.endsWith('.gupy.io')&&/^\/jobs?\/[^/]+/.test(parsed.pathname);
    if(provider==='github')return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&parsed.hostname==='github.com'&&/^\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/issues\/\d+$/i.test(parsed.pathname);
    if(provider==='linkedin') return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&['www.linkedin.com','br.linkedin.com'].includes(parsed.hostname)&&/^\/jobs\/view\//.test(parsed.pathname);
    if(provider==='indeed') return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&parsed.hostname==='br.indeed.com'&&parsed.pathname==='/viewjob'&&/^[a-f0-9]{16}$/.test(parsed.searchParams.get('jk')||'');
    const publicHost = parsed.hostname.includes('.') && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(parsed.hostname) && !/\.(local|internal|localhost)$/.test(parsed.hostname);
    // Greenhouse may return an employer's own careers domain. We never fetch this URL.
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && (provider === 'lever' ? parsed.hostname === 'jobs.lever.co' : provider === 'greenhouse' && publicHost);
  } catch { return false; }
}
