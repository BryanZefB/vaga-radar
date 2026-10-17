export const fold = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const has = (text, term) => {
  const escaped = fold(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text);
};
export function eligibility(job) {
  const location = fold(job.location);
  const text = fold(`${job.title} ${job.location} ${job.description}`);
  const remote = job.workplace === 'remote' || /\b(remote|remoto|remota|home office|anywhere)\b/.test(location);
  const hybrid = /\b(hybrid|hibrido|hibrida|on.?site|presencial)\b/.test(location) || ['hybrid','on-site'].includes(job.workplace);
  // Geography must be stated by the employer; LATAM/worldwide alone is inconclusive.
  const brazil = /\b(brasil|brazil)\b/.test(location);
  const blocked = /\b(only|somente|apenas)\s+(us|usa|united states|europe|eu)\b/.test(text);
  return { eligible: remote && !hybrid && brazil && !blocked, remote, brazil, hybrid };
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
  const titleSkillGaps = (profile.focusSkills || []).length ? ['Java','Angular','Python','Kotlin','Golang','PHP','Ruby','Go'].filter(term => has(title, term) && !profile.skills.some(skill => fold(skill) === fold(term))) : [];
  const excluded = profile.exclude.filter(term => has(text, term));
  const levelMatches = profile.levels.filter(term => has(text, term));
  const seniorTitle = /\b(senior|sr|staff|principal|lead|lider|manager|head|director|diretor|diretora|gerente|coordenador|coordenadora|supervisor|supervisora|master|expert|especialista|architect|arquiteto)\b/.test(title);
  const seniorAllowed = profile.levels.some(term => /senior|sênior|staff|principal|lead|lider|manager|head|director|diretor|gerente|coordenador|supervisor|master|expert|especialista|architect|arquiteto|^sr$/i.test(term));
  const levelConflict = profile.levels.length > 0 && seniorTitle && !seniorAllowed;
  const kinds = contracts(job);
  const contractMatch = !kinds.length || kinds.some(kind => profile.contracts.includes(kind));
  const configured = profile.roles.length > 0 || profile.skills.length > 0;
  const roleWeight = profile.roles.length ? 60 : 0;
  const skillWeight = profile.skills.length ? 30 : 0;
  const levelWeight = profile.levels.length ? 10 : 0;
  const denominator = roleWeight + skillWeight + levelWeight;
  const score = !configured ? null : Math.round(100 * ((roleMatches.length ? roleWeight : 0) + (profile.skills.length ? skillWeight * skillMatches.length / profile.skills.length : 0) + (levelMatches.length ? levelWeight : 0)) / denominator);
  return { ...job, kinds, score, roleMatches, skillMatches, focusMatches, titleSkillGaps, excluded, levelMatches, contractMatch,
    levelConflict,
    compatible: configured && titleSkillGaps.length === 0 && (!(profile.focusSkills || []).length || focusMatches.length > 0) && (!profile.roles.length || roleMatches.length > 0) && (!profile.skills.length || skillMatches.length > 0) && !levelConflict && excluded.length === 0 && contractMatch,
    salaryNote: profile.minSalary ? 'Salário mínimo não verificado: confira valor, moeda e período no anúncio.' : null,
    eligibility: eligibility(job) };
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
  if (!Number.isFinite(result.minSalary) || result.minSalary < 0 || result.minSalary > 1000000) throw new Error('Salário inválido.');
  return result;
}
export function normalize(provider, raw, source) {
  if (provider === 'lever') return {
    id: `lever:${source.slug}:${raw.id}`, source_id: source.id, company: source.company,
    title: plain(raw.text), location: plain(raw.categories?.location), workplace: raw.workplaceType || '',
    description: plain([raw.descriptionPlain || raw.description, ...(raw.lists || []).map(x => `${x.text} ${x.content}`), raw.additionalPlain || raw.additional].join(' ')).slice(0, 40000),
    url: raw.hostedUrl, published: raw.createdAt ? new Date(raw.createdAt).toISOString() : null,
  };
  return {
    id: `greenhouse:${source.slug}:${raw.id}`, source_id: source.id, company: source.company,
    title: plain(raw.title), location: plain(raw.location?.name), workplace: '',
    description: plain(raw.content).slice(0,40000), url: raw.absolute_url,
    // updated_at is not a publication timestamp.
    published: raw.first_published || null,
  };
}
export function sourceURL(source) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(source.slug)) throw new Error('Identificador de fonte inválido.');
  if (source.provider === 'lever') return `https://api.lever.co/v0/postings/${source.slug}?mode=json&limit=100&skip=0`;
  if (source.provider === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${source.slug}/jobs?content=true`;
  throw new Error('Provedor não permitido.');
}
export function safeJobURL(url, provider) {
  try {
    const parsed = new URL(url);
    const publicHost = parsed.hostname.includes('.') && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(parsed.hostname) && !/\.(local|internal|localhost)$/.test(parsed.hostname);
    // Greenhouse may return an employer's own careers domain. We never fetch this URL.
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && (provider === 'lever' ? parsed.hostname === 'jobs.lever.co' : provider === 'greenhouse' && publicHost);
  } catch { return false; }
}
