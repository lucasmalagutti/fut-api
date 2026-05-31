<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

API **FutMatch** (NestJS + Prisma/SQLite): reservas de quadras, partidas, pagamentos (carteira/cartão/PIX), carteira do dono e notificações.

Documentação interativa: `http://localhost:3000/api/docs` (com a API em execução).

## Project setup

```bash
npm install
# Configure .env (DATABASE_URL, Stripe, MAIL_*, etc.)
npm run db:sync
npm run prisma:seed    # dados iniciais (opcional)
```

## Compile and run the project

```bash
npm run start:dev      # desenvolvimento (watch)
npm run start:prod     # produção (após build)
npm run build
```

## Scripts de teste (partidas e jobs)

Comandos para **simular o fluxo completo** de uma partida em desenvolvimento, sem esperar o cron (~2h antes do horário). Execute na pasta `fut-api`, na ordem abaixo, substituindo `<matchId>` pelo UUID da partida.

### Fluxo recomendado

| Ordem | Script | O que faz |
|-------|--------|-----------|
| 1 | `seed:match-players` | Cria/atualiza 10 jogadores simulados, inscreve na partida, carteira R$ 200, pagamento preferido `wallet` |
| 2 | `trigger:match-charge` | Verifica quorum, confirma reserva, define cotas e cobra participantes |
| 3 | `trigger:match-finalize` | Credita o dono (pendente), libera saldo disponível e marca reserva como `completed` |

```bash
# 1 — Jogadores na partida
npm run seed:match-players -- <matchId>

# 2 — Quorum + cobrança automática das cotas
npm run trigger:match-charge -- <matchId>

# 3 — Crédito do dono + liberação para saque
npm run trigger:match-finalize -- <matchId>
```

**Exemplo (fluxo completo):**

```bash
npm run seed:match-players -- 52be26d7-3a4e-460f-9b85-0e1974ee1ddd
npm run trigger:match-charge -- 52be26d7-3a4e-460f-9b85-0e1974ee1ddd
npm run trigger:match-finalize -- 52be26d7-3a4e-460f-9b85-0e1974ee1ddd
```

### Detalhes por script

#### `npm run seed:match-players -- <matchId>`

- Usuários: `sim.jogador01@futmatch.test` … `sim.jogador10@futmatch.test`
- Senha: `sim123456`
- Ajusta `maxPlayers` se necessário e deixa a reserva em `open` para o trigger de cobrança
- Reexecutar atualiza participantes existentes (preferência carteira)

#### `npm run trigger:match-charge -- <matchId>`

- Ignora a janela de 2h do cron; roda `BookingScheduler.triggerQuorumCharge()`
- Se quorum ≥ `minPlayers`: reserva `confirmed`, cotas calculadas, cobrança por carteira/cartão conforme inscrição
- Se a partida **já estava confirmada**: apenas recobra participantes ainda não pagos
- Sem `<matchId>`: usa a **última partida** com reserva `open` e sem `closedAt`

#### `npm run trigger:match-finalize -- <matchId>`

- Roda `BookingScheduler.triggerMatchFinalize()`
- Credita o dono (valor líquido após taxa da plataforma) e move de pendente → saldo disponível
- Reserva passa para `completed`
- Sem `<matchId>`: usa ID padrão definido em `prisma/trigger-match-finalize.ts` (altere no arquivo ou passe o argumento)

### Outros scripts úteis

```bash
npm run prisma:seed          # seed principal (usuários, quadras, etc.)
npm run unseed               # remove dados do seed
npm run fix:media-urls       # normaliza URLs /storage/... no banco (legado com IP fixo)
npm run db:sync              # prisma generate + migrate deploy
```

### Produção vs. desenvolvimento

Em produção, o mesmo fluxo ocorre pelos **crons** do `BookingScheduler` (quorum ~2h antes do início, crédito do dono no início, liberação ao fim da partida). Os triggers acima são atalhos para testes locais.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
