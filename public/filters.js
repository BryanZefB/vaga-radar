export const providerName = value => ({lever:'Lever',greenhouse:'Greenhouse',linkedin:'LinkedIn',indeed:'Indeed'}[value]||value||'Fonte');
const folded=value=>String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function hasSalary(salary){
  if(!salary) return false;
  if(Array.isArray(salary)) return salary.some(hasSalary);
  if(typeof salary!=='object') return false;
  return Object.entries(salary).some(([key,value])=>['min','max','minValue','maxValue','amount','value'].includes(key)&&typeof value==='number'&&value>0||typeof value==='object'&&hasSalary(value));
}
export function filterJobs(jobs,filters,now=Date.now()){
  return jobs.filter(job=>{
    if(filters.mode==='matches'&&!job.compatible) return false;
    const text=folded(`${job.title} ${job.company} ${job.description}`);
    if(filters.query&&!text.includes(folded(filters.query))) return false;
    if(filters.company&&job.company!==filters.company) return false;
    if(filters.provider&&job.provider!==filters.provider) return false;
    if(filters.level&&job.titleLevel!==filters.level) return false;
    if(filters.status&&job.status!==filters.status) return false;
    if(Number(filters.score||0)>(job.score||0)) return false;
    if(filters.contract&&(filters.contract==='unknown'?job.kinds.length>0:!job.kinds.includes(filters.contract))) return false;
    if(filters.skills&&!filters.skills.split(',').map(folded).filter(Boolean).every(term=>text.includes(term.trim()))) return false;
    if(filters.salary&&!hasSalary(job.details?.salary)) return false;
    if(filters.language&&(job.details?.language||'unknown').split('-')[0]!==filters.language) return false;
    if(filters.verification&&job.verification?.status!==filters.verification) return false;
    if(filters.published==='unknown'&&job.published) return false;
    if(filters.published&&filters.published!=='unknown'&&(!job.published||now-Date.parse(job.published)>Number(filters.published)*86400000||Date.parse(job.published)>now)) return false;
    if(filters.discovered&&(!job.first_seen||now-Date.parse(job.first_seen)>Number(filters.discovered)*86400000)) return false;
    return true;
  }).sort((a,b)=>filters.sort==='new'?b.first_seen.localeCompare(a.first_seen):filters.sort==='published'?(Date.parse(b.published)||0)-(Date.parse(a.published)||0):filters.sort==='company'?a.company.localeCompare(b.company,'pt-BR'):(b.score||0)-(a.score||0)||b.first_seen.localeCompare(a.first_seen));
}
