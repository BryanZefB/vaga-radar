# Vaga Radar

**Sistema publicado:** https://vaga-radar.bryanzef7.workers.dev — uso pessoal, protegido por senha.

Aplicação para acompanhar vagas explicitamente remotas e disponíveis para trabalhar do Brasil, com aderência ao perfil profissional de Bryan. Frontend sem bibliotecas externas, API em Cloudflare Workers e banco D1. O código não contém senha de acesso, token Cloudflare, currículo PDF, telefone ou e-mail do currículo.

## Buscar e filtrar

- **Para seu perfil** aplica cargos, tecnologias principais, habilidades, termos excluídos, contratação, senioridade e mínimos de experiência explícitos.
- **Todas no radar** mostra as vagas que passaram por Brasil e remoto, mesmo quando não combinam com o perfil.
- Filtros adicionais: empresa, fonte, nível indicado no título, aderência mínima, publicação, primeira descoberta, salvas/candidaturas, tecnologias, idioma declarado, salário estruturado e confirmação individual.
- Datas de publicação ausentes nunca são substituídas por datas de coleta. Não interpretamos `full-time` automaticamente como CLT.
- O perfil profissional é editável. O currículo fornecido indica 2+ anos de desenvolvimento, Node.js/NestJS, React, TypeScript, PostgreSQL e AWS. O PDF não é armazenado no aplicativo nem enviado aos portais.

## Descrição e informações completas

Clique em **Descrição completa e todas as informações** em qualquer vaga. A janela mostra o texto integral disponibilizado pela fonte, requisitos e benefícios incluídos nesse texto, localização original, contratação, departamento, datas, remuneração estruturada, evidências de Brasil/remoto, motivos da aderência, dados complementares e link original. Descrições não são cortadas em 40 mil caracteres.

Campos que a fonte não informa aparecem como não informados. Não inventamos salário, prazo, idioma ou requisitos. O filtro de salário exige valores estruturados, mas o texto completo também pode mencionar remuneração. O salário mínimo do perfil é uma preferência sinalizada, sem conversão automática de moedas/períodos.

## Fontes

O banco inicial inclui páginas públicas de carreira em Greenhouse/Lever (Nubank, CloudWalk, Wellhub, CI&T, Stone, EBANX e dLocal), além de buscas públicas de LinkedIn e Indeed. A sugestão antiga Truelogic permanece pausada após HTTP 404. Fontes sem vagas elegíveis continuam mostrando zero; a existência de uma página de carreira não implica haver oportunidades para este perfil.

**LinkedIn e Indeed têm conectores reais de páginas públicas**, sem conta, cookies de login, execução de JavaScript remoto, contorno de CAPTCHA ou de bloqueios. As consultas usam os termos profissionais do perfil, Brasil, modalidade remota e parâmetros de data. O sistema lê até 10 descrições acessíveis por consulta, após excluir títulos acima dos níveis selecionados. Uma busca não representa todo o portal, e os filtros do portal são reconferidos na descrição/campos publicados: um resultado em uma busca por remoto pode ser híbrido e ficar fora do radar.

Bloqueios, login obrigatório, HTTP 403/429, formato alterado ou descrição indisponível geram diagnóstico. O sistema não simula resultados nem importa apenas título sem a descrição. Em **Fontes de vagas**, o botão para a busca original permite consultar o portal diretamente. LinkedIn/Indeed podem limitar o acesso a partir da Cloudflare mesmo quando as páginas respondem em outro ambiente.

Há até 12 fontes cadastradas. O cron executa a cada hora e consulta até 5 fontes em rodízio; cada fonte tem intervalo mínimo de 110 minutos entre tentativas. O botão de atualização respeita os mesmos limites. As APIs de Lever são paginadas; fontes muito grandes são interrompidas com diagnóstico, em vez de importar uma lista incompleta e encerrar vagas por engano. A remoção de um resultado de uma busca parcial de LinkedIn/Indeed **não** significa encerramento.

## O que a verificação confirma

- **Listada na fonte:** o anúncio estava na resposta pública da fonte na última coleta.
- **Reconfirmada na fonte:** a ação **Consultar novamente na fonte** consultou a publicação individual e conferiu identificador, texto, URL, país e modalidade. Consultas individuais são limitadas a uma a cada 5 minutos por vaga.
- **Precisa reconfirmação:** não foi possível consultar a origem ou a evidência ficou antiga.
- **Encerrada na fonte:** a consulta individual retornou 404/410 ou indicação explícita de encerramento; nas APIs completas, a ausência depois de uma importação completa também encerra o registro.
- **País/modalidade não confirmados:** a revisão individual não confirmou os critérios, sem presumir que o anúncio foi encerrado.

O radar exige evidência de Brasil (país informado, localização brasileira inequívoca, título ou residência explicitamente requerida) e de remoto (campo estruturado, localização, título ou declaração clara do modelo). Híbrido/presencial e restrições explícitas incompatíveis ficam fora. LATAM/worldwide sem Brasil continua inconclusivo. Uma empresa brasileira não basta para inferir que uma vaga pode ser exercida no Brasil.

A confirmação é da **presença e dos dados do anúncio**, não uma garantia absoluta de legitimidade, identidade do recrutador ou contratação. Confira empresa, domínio e processo e não pague para participar. Não prometemos exclusividade nem descobrir uma vaga antes de todas as outras pessoas. Registros sem presença recente na origem (6 horas) saem do radar; favoritos preservam o histórico com o estado disponível.

## Aderência e limites

A pontuação usa palavras-chave de cargo, habilidades e nível. Pelo menos uma tecnologia principal deve aparecer. Com a stack principal ativa, títulos com tecnologias como Java/Angular fora das habilidades cadastradas não são recomendados só porque citam Node.js como diferencial. Gestão, sênior, master e especialista ficam fora com o perfil inicial júnior/pleno. Requisitos mínimos de experiência explicitamente identificados acima dos anos cadastrados também ficam fora.

Não há análise infalível de todos os requisitos, inglês, autorização de trabalho, formação ou anos de experiência. Casos não claros exigem leitura. A formação informada está concluída: estágios podem exigir matrícula ativa. A aplicação registra apenas candidaturas marcadas pelo usuário; não se candidata nem envia currículos automaticamente.

## Desenvolvimento

Node.js 22.13+ (validado com Node 24); os testes usam `node:sqlite`.

```bash
npm ci
npm test
npm run db:local
npm run dev
```

Para desenvolvimento, configure `APP_PASSWORD` (12+ caracteres) e `SESSION_SECRET` (32+ caracteres aleatórios) em `.dev.vars`, ignorado pelo Git. Não use segredos de produção em exemplos, commits ou capturas. O cron não roda automaticamente no modo local.

Em ambientes com diretório pessoal somente leitura, use `npm ci --cache /tmp/vaga-radar-npm-cache` e o prefixo `XDG_CONFIG_HOME=/tmp/vaga-radar-config WRANGLER_SEND_METRICS=false` para Wrangler.

## Publicação e configuração

A conta, o ID do D1, o binding `DB`, os assets e o cron estão em `wrangler.jsonc`. Esses IDs não são credenciais. `keep_vars: true` preserva as variáveis e os segredos configurados no servidor durante os deploys.

A produção já existe. Para uma nova conta, ajuste `account_id`, crie o D1 (`npx wrangler d1 create vaga-radar`), preencha seu `database_id`, configure os segredos e aplique as migrações na base correta. Para atualizar a instalação atual com novas migrações:

```bash
npm run db:remote
npm run deploy
```

O repositório está ligado a Workers Builds. O comando de deploy do painel é `npx wrangler deploy`; migrações novas devem ser aplicadas antes do deploy. Segredos de produção: `APP_PASSWORD` e `SESSION_SECRET`. O token administrativo é fornecido separadamente pelo ambiente seguro como `CLOUDFLARE_API_TOKEN`, restrito a `api.cloudflare.com`. Nenhum desses valores é versionado. Rotacionar `SESSION_SECRET` invalida as sessões.

Antes de modificar o esquema, faça backup D1. As migrações preservam vagas, perfil e favoritos. As páginas externas são tratadas como dados não confiáveis; descrições são convertidas em texto e escapadas, nunca executadas como código.

## Plano gratuito

Não há dependência de API paga, IA paga, domínio comprado ou plano pago ativado pelo projeto. O desenho limita fontes, volume, tamanho de respostas e consultas. As cotas e termos de Cloudflare e dos portais podem mudar, e o uso real deve ser acompanhado. Limites atuais de coleta: 200 vagas elegíveis por fonte, 1.500 registros Greenhouse, 500 Lever e 10 descrições por consulta de cada portal público. Acima disso a fonte recebe diagnóstico; não alteramos os limites da conta para um plano pago.

Documentação: https://developers.cloudflare.com/workers/platform/pricing/ e https://developers.cloudflare.com/d1/platform/limits/ .

## Testes

`npm test` cobre país/modalidade, pontuação, stack, experiência, filtros, parsers públicos, autenticação, persistência, paginação, estados de verificação e preservação de dados na migração. Testes com respostas simuladas são distintos de coletas reais. A interface foi exercitada no Chromium local, inclusive descrição integral e filtros no celular. A validação em produção usa HTTPS com verificação TLS mantida; o armazenamento de certificados do navegador não é alterado pelo projeto.
