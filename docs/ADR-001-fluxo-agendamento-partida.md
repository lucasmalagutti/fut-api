# ADR-001: Fluxo de Agendamento de Partida com Rateio, Quórum e Pagamento Diferido

**Status:** Proposed  
**Data:** 2026-05-24  
**Decisores:** Equipe FutMatch  
**Contexto relacionado:** Diagrama de casos de uso FutMatch (2026), fluxo de agendamento documentado pelos autores

---

## Contexto

O FutMatch é uma plataforma de reserva de quadras esportivas onde o modelo de negócio central é o **agendamento coletivo de partidas**, não a reserva individual de um horário inteiro. O fluxo atual (implementado) trata cada reserva como uma transação individual de um único jogador pagando o valor total da quadra. Isso diverge completamente do modelo de negócio descrito:

- O Dono da Quadra define o **valor total do horário** (ex: R$ 150,00/1h30min) e o **mínimo de jogadores** para confirmar a partida.
- Múltiplos Jogadores reservam **vagas individuais** no mesmo horário.
- O valor é **rateado** entre todos os participantes confirmados, incluindo visitantes.
- A cobrança só ocorre **se o quórum for atingido** — 2h antes do início.
- Jogadores podem convidar **visitantes** (sem cadastro), respondendo financeiramente pela cota de ambos.
- O saque do Dono só é liberado **após o encerramento** da partida.

O schema atual (`Booking → Match → MatchParticipant`) já sinaliza a intenção desse modelo, mas a lógica de negócio não foi implementada. O `Booking` hoje representa "reserva de horário inteiro por um jogador" quando deveria representar "sessão de quadra com múltiplos participantes".

---

## Decisão

Redefinir o modelo de domínio e o fluxo de agendamento para refletir o modelo coletivo:

1. **`Booking`** passa a representar a **sessão de quadra** (o horário reservado pelo sistema), criado pelo primeiro jogador que inicia a partida, com `status: open` até fechar para novas adesões.
2. **`Match`** passa a ser o agregado central — contém as regras da partida (mínimo de jogadores, preço total, sport).
3. **`MatchParticipant`** registra cada jogador + seus visitantes convidados, com o valor de cota a pagar.
4. **Verificação de quórum** ocorre via cron job 2h antes do `startsAt` — cancela ou confirma a partida e dispara a cobrança.
5. **Pagamento** é disparado automaticamente após confirmação de quórum — cartão debitado imediatamente, PIX com janela de 1h antes do início.
6. **Bloqueio de conta** ativado para jogadores com PIX não pago após o prazo.
7. **Crédito na carteira do Dono** ocorre no momento do `startsAt`; **saque liberado** após `endsAt`.

---

## Opções Consideradas

### Opção A: Redefinir domínio completamente (escolhida)

Reestruturar `Booking` como sessão coletiva, `Match` como agregado de regras, `MatchParticipant` com cota individual.

| Dimensão | Avaliação |
|---|---|
| Alinhamento com o modelo de negócio | Alto — reflete exatamente o fluxo descrito |
| Complexidade de implementação | Alta — requer mudanças em schema, serviços e UI |
| Consistência de dados | Alta — uma fonte de verdade por partida |
| Escalabilidade | Alta — particpantes/visitantes desacoplados do pagamento |
| Esforço de migração | Médio — schema atual já tem estrutura base |

**Prós:** Modelo correto desde o início; evita gambiarras futuras; facilita features como chat por partida e avaliação mútua.  
**Contras:** Maior esforço de implementação; quebra o fluxo atual de pagamento individual.

---

### Opção B: Manter reserva individual, adicionar "split" na camada de pagamento

Cada jogador continua criando seu próprio `Booking` para o mesmo horário, e o sistema divide o custo entre todos os bookings ativos.

| Dimensão | Avaliação |
|---|---|
| Alinhamento com o modelo de negócio | Baixo — o quórum e o rateio ficam acoplados ao pagamento, não ao domínio |
| Complexidade de implementação | Média — menos mudanças no schema |
| Consistência de dados | Baixa — múltiplos bookings para o mesmo slot; race conditions de quórum |
| Escalabilidade | Baixa — lógica de rateio espalhada |

**Prós:** Menos mudanças imediatas.  
**Contras:** Tecnicamente frágil — conflito de slots entre bookings do mesmo horário; quórum calculado externamente sem transação atômica; visitantes não têm representação natural.

---

## Análise de Trade-offs

A Opção B parece mais rápida, mas cria dívida técnica severa: o check de conflito de slots (`status IN ['pending','confirmed']`) impediria dois jogadores de reservar o mesmo horário, que é exatamente o que o modelo coletivo requer. Seria necessário inverter toda a lógica de conflito. A Opção A, apesar de maior esforço inicial, é a única que suporta corretamente o quórum atômico, o rateio justo com visitantes e o bloqueio de conta por inadimplência.

---

## Modelo de Dados Resultante (schema Prisma)

```prisma
// Booking = a sessão de quadra (criada junto com a primeira Match)
model Booking {
  id          String        @id @default(uuid())
  courtId     String
  startsAt    DateTime
  endsAt      DateTime
  totalPrice  Float         // valor total do horário (definido pelo dono)
  status      BookingStatus @default(open)  // open | closed | confirmed | cancelled | completed
  // ...
  match       Match?
}

// Match = agregado da partida
model Match {
  id             String   @id @default(uuid())
  bookingId      String   @unique
  hostId         String   // jogador que criou a partida
  sport          String
  minPlayers     Int      // mínimo para confirmar
  maxPlayers     Int      // máximo de vagas (slots)
  isPublic       Boolean  @default(true)
  closedAt       DateTime? // quando o sistema fechou para novas adesões (startsAt - 2h)
  confirmedAt    DateTime?
  // ...
  participants   MatchParticipant[]
}

// MatchParticipant = cada vaga (jogador cadastrado + visitante opcional)
model MatchParticipant {
  id         String     @id @default(uuid())
  matchId    String
  userId     String     // jogador cadastrado (paga por si + visitante)
  guestName  String?    // nome do visitante convidado (opcional)
  slots      Int        @default(1) // 1 = só o jogador; 2 = jogador + 1 visitante
  quota      Float?     // calculado no momento da confirmação de quórum
  status     PartStatus @default(joined) // joined | paid | unpaid | cancelled
  paymentId  String?    // link para o Payment após cobrança
}
```

---

## Fluxo de Estados

```
Booking:  open → closed (T-2h) → confirmed (quórum ok) | cancelled (quórum insuf.)
                                       ↓
                               completed (T+endsAt)

MatchParticipant:  joined → paid | unpaid (após cobrança) → cancelled
```

---

## Impacto nos Módulos Existentes

### fut-api

| Módulo | Mudança necessária |
|---|---|
| `prisma/schema.prisma` | Adicionar `status: open\|closed` ao `BookingStatus`; campos `minPlayers`, `maxPlayers`, `closedAt`, `confirmedAt` em `Match`; campos `guestName`, `slots`, `quota`, `status`, `paymentId` em `MatchParticipant` |
| `bookings.service.ts` | `create()` cria Booking + Match atomicamente; remover lógica de `totalPrice` calculado por hora (vem do Dono); quórum não é responsabilidade do Booking |
| `matches.service.ts` | Novo serviço: `join(matchId, userId, guestName?)`, `leave()`, `checkQuorum()` |
| `BookingsScheduler` (novo) | Cron job T-2h: fecha inscrições, verifica quórum, dispara pagamentos ou cancela |
| `payments.service.ts` | `chargeParticipant(participant, method)` — cobrar cota individual; PIX com deadline T-1h |
| `wallet.service.ts` | `creditOwner()` chamado no `startsAt`; `unlockPayout()` chamado no `endsAt` |
| `users.service.ts` | `blockUser(userId, reason)` / `unblockUser()` para inadimplência PIX |

### fut-app

| Tela | Mudança necessária |
|---|---|
| `courts/[id].tsx` | Mostrar partidas abertas no horário; botão "Participar" além de "Reservar" |
| `booking/new.tsx` | Substituir por fluxo de "criar partida" (definir mínimo, máximo, público/privado) |
| `matches/index.tsx` | Listar partidas abertas para o jogador ingressar |
| `booking/[id].tsx` | Mostrar participantes, quórum, cota estimada, status de pagamento |
| Nova tela: `matches/[id].tsx` | Detalhes da partida: participantes, visitantes, cota, cronômetro de fechamento |

---

## Consequências

**O que fica mais fácil:**
- Rateio automático e correto mesmo com número variável de participantes e visitantes.
- Cancelamento limpo sem pagamento quando quórum não é atingido.
- Bloqueio de conta por inadimplência com escopo bem definido.
- Base sólida para chat por partida, avaliação mútua e histórico de participações.

**O que fica mais difícil:**
- A tela de reserva atual (`booking/new.tsx`) precisa ser reformulada — o jogador não escolhe mais "pagar R$150 agora", mas sim "entrar numa partida e aguardar o quórum".
- O e-mail de confirmação passa a ser disparado no momento do quórum (T-2h), não no ato da reserva.
- Testes de integração do cron job de quórum precisam de fixtures de tempo controlado.

**O que precisará ser revisitado:**
- Política de reembolso quando um jogador cancela após quórum atingido mas antes do início.
- Comportamento quando um jogador com PIX pendente tenta entrar em nova partida (bloquear na entrada ou só na cobrança?).
- Expiração da janela PIX: hoje o sistema bloqueia a conta; definir o processo de desbloqueio após quitação.

---

## Plano de Implementação

### Fase 1 — Schema e domínio (sem quebrar o fluxo atual)

- [ ] Adicionar campos ao schema: `BookingStatus` ganha `open` e `closed`; `Match` ganha `minPlayers`, `maxPlayers`, `closedAt`, `confirmedAt`; `MatchParticipant` ganha `guestName`, `slots`, `quota`, `status`, `paymentId`
- [ ] Adicionar `blockedAt` e `blockReason` em `User` para inadimplência
- [ ] Rodar `npx prisma db push && npx prisma generate`

### Fase 2 — Serviço de partidas

- [ ] Criar `MatchesService.createMatch(hostId, bookingId, { minPlayers, maxPlayers, sport, isPublic })`
- [ ] Criar `MatchesService.joinMatch(matchId, userId, guestName?)` — valida vagas, cria `MatchParticipant`
- [ ] Criar `MatchesService.leaveMatch(matchId, userId)` — só permitido antes do fechamento (T-2h)
- [ ] Criar `MatchesService.getOpenMatches(courtId, date)` — lista partidas com vagas abertas

### Fase 3 — Scheduler de quórum

- [ ] Criar `BookingScheduler` com cron a cada minuto verificando bookings com `startsAt` entre agora e T+2h
- [ ] Lógica de fechamento: marcar `Match.closedAt`, calcular quotas, disparar pagamentos
- [ ] Lógica de cancelamento: notificar participantes, marcar `Booking.status = cancelled`
- [ ] Lógica de crédito do dono: creditar wallet no `startsAt`, liberar saque no `endsAt`

### Fase 4 — Pagamento por cota

- [ ] `PaymentsService.chargeParticipant()`: cobrar `participant.quota * participant.slots` por cartão (automático) ou PIX (janela T-1h)
- [ ] Cron de vencimento PIX: bloquear usuário se PIX não pago antes de T-1h
- [ ] `UsersService.unblock()`: liberar conta após quitação

### Fase 5 — Interface do jogador

- [ ] Reformular `booking/new.tsx` → criar partida (mínimo, máximo, público/privado)
- [ ] Tela `matches/[id].tsx`: participantes, cota estimada, cronômetro
- [ ] `courts/[id].tsx`: seção "Partidas abertas neste horário" com botão "Participar"

---

## Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| Race condition ao ingressar (duas pessoas preenchem a última vaga simultaneamente) | `joinMatch()` executa em transação Prisma com `findFirst` + `create` atômica; retorna 409 se vagas esgotadas |
| Quórum verificado fora do horário certo por drift do cron | Usar janela de T-2h ± 5min; idempotência na verificação (checar `closedAt IS NULL`) |
| PIX não pago bloqueia conta mas jogador já está na partida | Bloquear **novas** participações; partida atual segue; cobrança judicial/suporte manual |
| Visitante aparece no rateio mas não tem conta | `MatchParticipant.guestName` registra o nome; pagamento é responsabilidade do anfitrião; sem notificação direta ao visitante |

---

## Referências

- Diagrama de casos de uso FutMatch (2026) — autores
- Fluxo de agendamento de partida — documento de especificação (2026)
- Schema atual: `fut-api/prisma/schema.prisma`
- Implementação atual: `fut-api/src/modules/bookings/bookings.service.ts`
