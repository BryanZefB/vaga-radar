import { plain, fold } from './domain.js';

// Read public HTML/JSON only. Never execute page scripts or follow login challenges.
export function jsonAssignment(html, marker) {
  let start = html.indexOf(marker);
  if (start < 0) throw new Error('Formato público da fonte mudou.');
  start = html.indexOf('{', start + marker.length);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue; }
    if(c==='"') quoted=true;
    else if(c==='{') depth++;
    else if(c==='}' && --depth===0) return JSON.parse(html.slice(start,i+1));
  }
  throw new Error('Formato JSON incompleto na fonte pública.');
}
function element(html, className) {
  const match = new RegExp(`<([a-z][\\w-]*)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'i').exec(html);
  if (!match) return '';
  const start = match.index + match[0].length;
  const tags = new RegExp(`<\\/?${match[1]}\\b[^>]*>`, 'gi');
  tags.lastIndex=start;
  let depth=1, next;
  while ((next=tags.exec(html))) {
    depth += next[0].startsWith('</') ? -1 : 1;
    if (!depth) return html.slice(start,next.index);
  }
  return '';
}
export function linkedInCards(html) {
  return html.split(/<li\b/i).slice(1).flatMap(chunk => {
    const id=/data-entity-urn="urn:li:jobPosting:(\d+)"/.exec(chunk)?.[1];
    if(!id) return [];
    return [{ id, title:plain(element(chunk,'base-search-card__title')), company:plain(element(chunk,'base-search-card__subtitle')),
      location:plain(element(chunk,'job-search-card__location')), published:/<time\b[^>]*datetime="([^"]+)"/.exec(chunk)?.[1] || null }];
  });
}
export function indeedCards(html) {
  const data=jsonAssignment(html,'window.mosaic.providerData["mosaic-provider-jobcards"]=');
  const cards=data.metaData?.mosaicProviderJobCardsModel?.results;
  if(!Array.isArray(cards)) throw new Error('Formato público do Indeed mudou.');
  return cards.filter(card=>/^[a-f0-9]{16}$/.test(card.jobkey)).map(card=>({id:card.jobkey,title:plain(card.title||card.displayTitle),company:plain(card.company),location:plain(card.formattedLocation||card.jobLocationCity||'')}));
}
export function indeedDetail(html, card) {
  const scripts=[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const objects=scripts.flatMap(match=>{try {const data=JSON.parse(match[1]);return Array.isArray(data)?data:data['@graph']||[data];}catch{return [];}});
  const job=objects.find(item=>item['@type']==='JobPosting'||item['@type']?.includes?.('JobPosting'));
  if(!job || !job.description) throw new Error('Descrição pública completa indisponível no Indeed.');
  const regions=[].concat(job.applicantLocationRequirements||[],job.jobLocation||[]);
  const countries=regions.map(x=>typeof x==='string'?x:[x.name,x.address?.addressCountry,x.address?.addressLocality].filter(Boolean).join(' ')).join(' | ');
  const countryCode=regions.map(x=>x.address?.addressCountry).find(Boolean);
  return {...card,title:plain(job.title||card.title),company:plain(job.hiringOrganization?.name||card.company),
    location:[card.location,countries].filter(Boolean).join(' | '), country:countryCode,
    workplace:job.jobLocationType==='TELECOMMUTE'?'remote':'',description:plain(job.description),published:job.datePosted||null,
    details:{employmentType:job.employmentType||null,salary:job.baseSalary||null,deadline:job.validThrough||null,experience:job.experienceRequirements||null,education:job.educationRequirements||null,benefits:job.jobBenefits||null,skills:job.skills||null,industry:job.industry||null},
    url:`https://br.indeed.com/viewjob?jk=${card.id}`};
}
export function linkedInDetail(html, card) {
  const description=plain(element(html,'show-more-less-html__markup'));
  if(!description) throw new Error('Descrição pública completa indisponível no LinkedIn.');
  const criteria=[...html.matchAll(/<li\b[^>]*class="[^"]*description__job-criteria-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)].map(m=>plain(m[1]));
  return {...card,title:plain(element(html,'top-card-layout__title'))||card.title,
    company:plain(element(html,'topcard__org-name-link'))||card.company,description,workplace:'',
    details:{criteria},url:`https://www.linkedin.com/jobs/view/${card.id}`};
}
export function discoveryQuery(profile) {
  const terms=[...new Set((profile.focusSkills?.length?profile.focusSkills:profile.skills||[]).map(term=>{const key=fold(term).replace(/[.\s]/g,'');return ({nodejs:'Node.js',nestjs:'NestJS',reactjs:'React',react:'React'})[key]||term;}))].slice(0,4);
  return terms.length?terms.join(' OR '):'desenvolvedor full stack';
}
export function publicSearchURL(provider, query) {
  if(provider==='linkedin') {
    const url=new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
    url.search=new URLSearchParams({keywords:query,location:'Brazil',f_WT:'2',f_E:'1,2,3',f_TPR:'r2592000',sortBy:'DD',start:'0'});
    return url.toString();
  }
  if(provider==='indeed') {
    const url=new URL('https://br.indeed.com/jobs');
    url.search=new URLSearchParams({q:query,l:'Brasil',sc:'0kf:attr(DSQF7);',sort:'date',fromage:'30'});
    return url.toString();
  }
  throw new Error('Provedor público inválido.');
}
export function publicDetailURL(provider,id) {
  if(provider==='linkedin' && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
  if(provider==='indeed' && /^[a-f0-9]{16}$/.test(id)) return `https://br.indeed.com/viewjob?jk=${id}`;
  throw new Error('Identificador público inválido.');
}
