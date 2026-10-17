# Vaga Radar

Aplicação web pessoal para Bryan acompanhar oportunidades remotas no Brasil. Frontend em português, Worker com API privada, SQLite/D1, coleta programada, perfil editável, favoritos e acompanhamento manual de candidaturas.

## O que está implementado

- Perfil profissional inicial baseado no currículo, sem telefone, e-mail ou URL pessoal.
- CLT, PJ e estágio. `Full-time` não é convertido automaticamente em CLT.
- Pontuação explicada por cargo, tecnologias e nível. Títulos sênior/lead/staff ficam fora das recomendações iniciais.
- Localização Brasil e remoto explícitos. Híbrido, presencial e LATAM/worldwide sem Brasil ficam fora. Isso reduz falsos positivos, mas perde anúncios com localização incompleta.
- APIs públicas de páginas de carreira Lever e Greenhouse. Os três identificadores iniciais são sugestões ainda não confirmadas com coleta real.
- Coleta a cada duas horas. Botão de atualização respeita intervalo de 110 minutos por fonte após sucesso.
- Deduplicação por provedor, empresa e identificador original; preservação da primeira descoberta; encerramento de anúncios removidos da fonte após coleta completa bem-sucedida.
- Fonte sem coleta nas últimas seis horas ou com erro deixa de alimentar o radar até uma coleta bem-sucedida. Favoritos continuam disponíveis com aviso.
- Senha pessoal, cookie HttpOnly/Secure em HTTPS, sessão assinada por sete dias, proteção de origem e limite persistente de dez tentativas de login a cada quinze minutos.

Não usa IA paga, banco pago, e-mail transacional ou domínio comprado. Não envia currículos nem faz candidaturas automaticamente. Não há dados de vagas fictícias no banco inicial.

## Limites da busca

Nenhum sistema pode garantir chegar antes de todas as outras pessoas, exclusividade, legitimidade absoluta ou cobertura de toda a web. O aplicativo consulta vagas públicas; a rapidez depende do cron e de quando a empresa publica no ATS. O horário do cron não é um SLA.

A pontuação é uma heurística de palavras-chave, não uma probabilidade de contratação. Inglês, anos de experiência, formação, autorização de trabalho e todos os requisitos do anúncio precisam de conferência. Salário mínimo é apenas uma preferência sinalizada; não é aplicado como filtro rígido porque valor, moeda e período não são estruturados nessas fontes. Estágios podem exigir matrícula ativa, mesmo com uma graduação concluída.

“Publicação” e “primeira coleta” são datas distintas. Alteração de anúncio no Greenhouse não é tratada como publicação nova. A fonte confirma que o anúncio estava listado na última coleta, não que está aberto neste instante. Uma empresa usar um ATS conhecido não elimina fraudes: confira empresa, domínio e recrutador; nunca pague para participar de um processo.

## Rodar e desenvolver

Requer Node.js 22+; os testes usam `node:sqlite`, disponível a partir do Node 22.13. Validado aqui com Node 24.19.

```bash
cd /workspace/vaga-radar
npm ci
npm test
npm run db:local
```

Crie `.dev.vars`, ignorado pelo Git, com `APP_PASSWORD` (12 ou mais caracteres) e `SESSION_SECRET` (32 ou mais caracteres aleatórios). Use uma senha forte e exclusiva. Os valores locais gerados nesta sessão servem somente ao desenvolvimento; não estão no pacote de entrega.

```text
APP_PASSWORD=sua-senha-local-forte
SESSION_SECRET=segredo-aleatorio-longo-exclusivo-do-desenvolvimento
```

Depois execute `npm run dev`. O terminal informa a porta local. Nenhuma conta Cloudflare é necessária para os testes locais. O cron não executa automaticamente no desenvolvimento; use o botão de atualizar para uma coleta manual.

Em ambientes com diretório pessoal somente leitura, use um cache gravável (`npm ci --cache /tmp/vaga-radar-npm-cache`) e `XDG_CONFIG_HOME=/tmp/vaga-radar-config WRANGLER_SEND_METRICS=false` antes dos comandos Wrangler.

## Publicar sem comprar domínio

O produto é acessado inteiramente no navegador após publicado. Os comandos abaixo também podem ser executados em um terminal cloud, sem instalar ferramentas no seu computador.

1. Crie uma conta em https://dash.cloudflare.com/sign-up e mantenha **Workers Free**. Não contrate Workers Paid nem serviços pagos para esse projeto.
2. No terminal do projeto, execute `npx wrangler login` e conclua o fluxo oficial no navegador. Nunca compartilhe senha ou token pelo chat.
3. Execute `npx wrangler d1 create vaga-radar`. Copie somente o `database_id` retornado para o campo correspondente em `wrangler.jsonc`; mantenha o binding `DB`.
4. Execute `npm run db:remote` para aplicar as migrações na base nova. Não execute isso sobre uma base de outra aplicação.
5. Execute `npm run deploy`. O Worker usa o endereço gratuito `workers.dev` atribuído pela Cloudflare. A API permanece bloqueada enquanto os segredos não estiverem configurados.
6. Execute `npx wrangler secret put APP_PASSWORD` e digite uma senha forte de pelo menos 12 caracteres no terminal seguro. Execute `npx wrangler secret put SESSION_SECRET` e informe um valor aleatório de pelo menos 32 caracteres. Também é possível configurar os segredos nas configurações do Worker pelo painel e publicar a alteração. Não coloque esses valores no código ou em commits.
7. Abra o endereço informado pela publicação, entre com a senha e clique em **Atualizar fontes**. Veja **Fontes de vagas**: valide cada empresa, o resultado da consulta e a data. Fontes que não existirem precisam ser substituídas por identificadores reais de páginas que você conhece.
8. Confira se um anúncio exibido tem Brasil e remoto, abra a publicação original e valide seu conteúdo. Salve uma vaga e recarregue para conferir persistência.
9. No painel, confira os Cron Triggers e métricas depois da primeira execução programada. Publicar o código não comprova que a coleta agendada já ocorreu.

Rotacionar `SESSION_SECRET` encerra todas as sessões existentes. Não reutilize credenciais de outros serviços. Exporte periodicamente o D1 pelo mecanismo de backup da Cloudflare se desejar preservar favoritos e perfil.

## Gratuidade e tamanho

O projeto foi desenhado para uso individual nas cotas gratuitas de Workers e D1, com até oito fontes, 1.500 anúncios brutos por resposta e 150 anúncios elegíveis por fonte. Acima desses limites a coleta daquela fonte falha com diagnóstico, sem encerrar anúncios antigos. Não há dependência de pagamento, mas os limites e termos da plataforma podem mudar. Confira os limites atuais no painel antes de publicar; não ative upgrades automáticos.

Leitura oficial: https://developers.cloudflare.com/workers/platform/pricing/ e https://developers.cloudflare.com/d1/platform/limits/ . O desempenho e o consumo real de CPU do cron precisam ser medidos na conta gratuita; não foram validados em produção nesta sessão.

## Adicionar empresas

Em **Fontes de vagas**, escolha Lever ou Greenhouse e informe empresa e identificador da página oficial. Por exemplo, em `jobs.lever.co/empresa`, o identificador é `empresa`. O aplicativo só consulta os dois hosts fixos de API; não faz scraping de LinkedIn/Indeed nem aceita URLs arbitrárias como fontes. O link final do anúncio Greenhouse pode apontar para o domínio de carreira da própria empresa.

Uma fonte pausada não é consultada e suas vagas saem do radar. O limite de oito inclui fontes pausadas. Para substituir uma fonte existente, ajuste conscientemente seu registro no banco; não há exclusão de histórico na interface desta versão.

## Validação realizada

- Testes automatizados de elegibilidade, pontuação, senioridade, contratos, entrada inválida e URLs.
- API privada: autenticação, assinatura de sessão, origem, limite de login, edição de perfil, favoritos.
- Importação com respostas de teste: inserção, deduplicação, encerramento, preservação de favoritos e tratamento de erro HTTP.
- Migrações aplicadas no D1 local, Worker iniciado com Wrangler e navegação real em Chromium desktop e celular.
- A coleta externa real ficou bloqueada por HTTP 403 do proxy de saída deste ambiente para `api.lever.co` e `boards-api.greenhouse.io`. Os testes de conector são simulados; não comprovam que os três boards iniciais existem ou têm vagas adequadas hoje.
- Não publicado: falta conta/autenticação Cloudflare, criação do D1 e segredos de produção. Não há validação de cron ou das cotas em produção.

## Estrutura

`src/worker.js`: autenticação, API, cron e persistência. `src/domain.js`: normalização e regras de aderência. `public/`: interface sem bibliotecas externas. `migrations/`: banco e perfil inicial. `test/`: testes sem acesso externo. `wrangler.jsonc`: configuração de publicação. `package-lock.json`: dependências fixadas.

O acervo `skills-bryan` permanece separado e sem alterações.

## Atualização da preparação de publicação

Com a rede liberada, a API pública Greenhouse da Wellhub (`gympass`) respondeu com 88 anúncios, dos quais 23 passaram pelo filtro estrito de Brasil e remoto na consulta de preparação. Isso confirma a leitura e normalização da fonte naquele momento, não uma publicação do sistema nem a aderência das 23 vagas ao perfil. A migração `0004_verified_source.sql` adiciona essa fonte e pausa a sugestão `truelogic`, que retornou HTTP 404. O acesso Cloudflare ainda precisa ser concedido pelo segredo seguro `CLOUDFLARE_API_TOKEN` para criar o D1 e publicar.
