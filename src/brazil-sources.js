import { plain, fold } from './domain.js';

const stateNames='acre|alagoas|amapa|amazonas|bahia|ceara|distrito federal|espirito santo|goias|maranhao|mato grosso|mato grosso do sul|minas gerais|para|paraiba|parana|pernambuco|piaui|rio de janeiro|rio grande do norte|rio grande do sul|rondonia|roraima|santa catarina|sao paulo|sergipe|tocantins'.split('|');
const stateCodes='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
export const validRepository = slug => /^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/i.test(slug||'');
const localCLT = text => /\bclt\b/i.test(text)&&!/\b(?:nao|sem)\s+(?:e\s+)?clt\b/.test(fold(text));
export function gupyQueries(profile,query=''){
  if(query.trim())return [query.trim()];
  const skills=profile.focusSkills?.length?profile.focusSkills:profile.skills||[];
  const terms=skills.map(term=>{const key=fold(term).replace(/[.\s]/g,'');return ({nodejs:'Node',nestjs:'NestJS',reactjs:'React',react:'React'})[key]||term;});
  return [...new Set(terms)].slice(0,3).length?[...new Set(terms)].slice(0,3):['desenvolvedor'];
}
export function gupyURL(query,offset=0){
  const url=new URL('https://portal.gupy.io/api/job-search/jobs');
  url.search=new URLSearchParams({jobName:query,limit:'50',offset:String(offset),workplaceType:'remote'});
  return url.toString();
}
export function normalizeGupy(raw){
  const description=plain(raw.description).replace(/(Responsabilidades e atribui[çc][õo]es|Requisitos e qualifica[çc][õo]es|Informa[çc][õo]es adicionais)/gi,'\n\n$1\n');
  const state=plain(raw.state),city=plain(raw.city);
  const declaredCountry=plain(raw.country||'');
  const country=/^(br|brasil|brazil)$/i.test(declaredCountry)||stateCodes.includes(state.toUpperCase())||stateNames.includes(fold(state))?'BR':localCLT(description)?'BR':'';
  const brazilBasis=declaredCountry?'País declarado':state?'Estado brasileiro declarado':country?'Contratação CLT mencionada no anúncio':null;
  const location=[city,state,country?'Brasil'+(brazilBasis?.startsWith('Contrata')?' (contexto CLT)':''):declaredCountry].filter(Boolean).join(', ');
  return {id:String(raw.id),title:plain(raw.name),company:plain(raw.careerPageName)||'Empresa não informada',location,country,
    workplace:raw.workplaceType||'',description,published:raw.publishedDate||null,url:raw.jobUrl,
    details:{state,city,brazilBasis,employmentType:raw.type||null,deadline:raw.applicationDeadline||null,language:raw.language||null,careerPageUrl:raw.careerPageUrl||null,sourceId:raw.id}};
}
function section(body,name){
  const escaped=name.split('|').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const match=new RegExp(`(?:^|\\n)#{1,4}\\s*(?:${escaped})\\s*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`,'i').exec(body);
  return plain(match?.[1]||'');
}
export function normalizeIssue(raw){
  const body=String(raw.body||'');
  const labels=(raw.labels||[]).map(label=>typeof label==='string'?label:label.name||'');
  const local=section(body,'Local|Localização|Localizacao|Local de trabalho');
  const title=plain(raw.title);
  const place=title.match(/^\[([^\]]+)\]/)?.[1]||'';
  const country=localCLT(plain(body))?'BR':'';
  const location=[local,place,...labels.filter(label=>/remot|h[ií]brid|presencial|brasil|brazil|^BR$/i.test(label)),country?'Brasil (contexto CLT)':''].filter(Boolean).join(' | ');
  const namedCompany=title.match(/\s+(?:na|no|at|@)\s+([^\n]{2,80})$/i)?.[1]||'';
  const companyBlock=section(body,'Empresa|Nossa empresa|A empresa');
  const company=namedCompany||(companyBlock&&!companyBlock.includes('\n')&&companyBlock.length<=100?companyBlock:'Empresa não identificada na publicação');
  return {id:String(raw.number),title,company,location,country,workplace:'',description:plain(body),published:raw.created_at||null,url:raw.html_url,
    details:{labels,publisher:raw.user?.login||null,updatedAt:raw.updated_at||null,issueState:raw.state,communityPost:true,employerVerified:false,brazilBasis:country?'Contratação CLT mencionada no anúncio':null,applicationInstructions:section(body,'Como se candidatar|Como se inscrever|Candidatura|Inscrição|Contratação')}};
}
export function issueURL(repository,number){
  if(!validRepository(repository)||!/^\d+$/.test(String(number)))throw new Error('Identificador de comunidade inválido.');
  return `https://api.github.com/repos/${repository}/issues/${number}`;
}
