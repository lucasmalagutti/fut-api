# Changelog – FutMatch

---

## [2026-05-26] – Cancelamento de partida, filtros, múltiplos esportes e link de convite

### fut-api

#### Cancelamento de partida
- Novo endpoint `DELETE /matches/:id`: cancela a partida se não confirmada ainda.
- Marca todos os participantes como `cancelled` e a booking como `cancelled` atomicamente.
- Retorna erro 400 se a partida já foi confirmada (quórum + pagamento processado).
- Apenas o organizador (host) pode cancelar.

#### Múltiplos esportes por quadra
- `Court.sport` agora suporta JSON array serializado: `'["Society","Futevôlei"]'`.
- `CourtsService.create` e `update` aceitam `sports: string[]` e serializam automaticamente.
- `CourtsService.findAll` usa `contains` para filtrar por esporte, compatível com arrays.
- `CourtsService.findOne` deserializa e expõe campo `sports: string[]` além de `sport` (retrocompat).
- Helper `parseCourt()` centraliza deserialização de `amenities` e `sport` em todas as queries.
- `CreateCourtDto` aceita `sports?: string[]` além de `sport?: string`.

### fut-app

#### Cancelamento de partida — interface do organizador
- Botão "Cancelar partida" em `matches/[id].tsx`, visível apenas para o host e apenas se a partida não foi confirmada.
- Exibe alerta de confirmação antes de executar.
- Após cancelar, invalida cache e redireciona para Minhas Reservas.
- `matchesService.cancel(matchId)` adicionado ao service do app.

#### Compartilhamento de link de partida privada
- Botão "Compartilhar convite" em `matches/[id].tsx` disponível para o host de partidas privadas.
- Ícone de compartilhamento no header disponível para qualquer partida (pública ou privada).
- Usa a React Native `Share` API com mensagem + deep link `futmatch://matches/:id` e URL web fallback.

#### Minhas Reservas — novos filtros
- Filtros adicionados: "Aguard. pagamento" e "Confirmadas".
- "Aguard. pagamento": reservas com status `pending` + partidas com participantes em `joined` ou `unpaid`.
- "Confirmadas": reservas com status `confirmed/completed` + partidas com `confirmedAt` preenchido.
- Mantidos os filtros existentes: "Todas", "Reservas", "Partidas".

#### Fix: bookings com status `open` não apareciam
- `BookingCard` e `booking/[id].tsx` agora tratam status `open` com label "Partida aberta".
- `Badge` inclui badge `primary` para status `open`.

#### Múltiplos esportes — interface do dono
- Cadastro de quadra (`new.tsx`): seleção múltipla de esportes com chips toggle; validação exige ao menos um.
- Edição de quadra (`[id].tsx`): seleção múltipla de esportes no modal de edição; exibição de todos os esportes na info card.

#### Múltiplos esportes — interface do jogador
- `booking/new.tsx`: quando a quadra tem mais de um esporte, exibe seletor de chips para o jogador escolher o esporte da partida. Quando tem apenas um, usa-o automaticamente sem exibir seletor.

---

## [2026-05-26] – Interface do jogador: partidas integradas em Minhas Reservas

### fut-app

#### Aba Matches removida da tab bar
- A aba "Partidas" foi removida da barra de navegação inferior do jogador.
- As rotas `matches/index` e `matches/[id]` continuam acessíveis mas não aparecem como tab.
- Partidas passaram a fazer parte da tela "Minhas Reservas", consolidando a navegação.

#### Minhas Reservas — lista unificada de reservas e partidas
- `bookings.tsx` reescrito para buscar reservas (`bookingsService.list()`) e partidas (`matchesService.findMine()`) em paralelo.
- Itens são ordenados por data (mais recente primeiro) em uma lista única.
- Filtros: "Todas", "Reservas" e "Partidas" permitem segmentar a lista.
- Cards de partida exibem: esporte, quadra, data/horário, vagas (ocupadas/máximo), cota estimada e badge de status (Aberta / Aguard. quórum / Confirmada).
- Ao tocar em um card de partida, navega para `/(player)/matches/[id]`.

#### Criar Partida — esporte fixo da quadra
- Removido o seletor de esportes da tela `booking/new.tsx`.
- O esporte é herdado automaticamente do campo `court.sport` da quadra reservada.
- O esporte é exibido como informação no card de resumo da quadra (somente leitura).
- Garante consistência: uma quadra de Society só cria partidas de Society.

#### Tela `matches/[id].tsx` — nova tela de detalhe da partida
- Exibe informações completas: quadra, data/horário, visibilidade, organizador.
- Countdown até o fechamento das inscrições (T-2h antes do início).
- Barra de progresso de vagas com alerta de quórum mínimo pendente.
- Lista de participantes com badge de status de pagamento por jogador.
- Ações contextuais: "Entrar" (sozinho ou com convidado via modal), "Sair", "Fazer check-in".

#### Tela `matches/index.tsx` — lista de partidas abertas e minhas partidas
- Abas "Abertas" (partidas públicas disponíveis para entrar) e "Minhas" (partidas do jogador).
- Botão "Participar" na aba "Abertas" entra na partida e navega para o detalhe.

#### Tela `courts/[id].tsx` — partidas abertas na data selecionada
- Seção "Partidas abertas nesta data" exibida quando há partidas públicas na quadra.
- Cards compactos mostram esporte, horário e cota estimada com link para participar.

---

## [2026-05-24] – Correcoes: timezone reserva, duplo submit e log de email

### fut-app

#### `app/(player)/booking/new.tsx` — timezone e duplo submit
- **Bug corrigido:** `startsAt`/`endsAt` eram montados sem offset (`"2024-05-24T14:00:00"`), fazendo o Node.js interpretar a hora como UTC em vez do fuso local. Em UTC-3 isso deslocava a reserva 3h no banco, causando o conflito "Time slot already booked" na primeira tentativa.
- Nova funcao `toLocalISO(date, time)` inclui o offset do dispositivo na string ISO (ex: `"2024-05-24T14:00:00-03:00"`), garantindo hora correta independente do fuso do servidor.
- **Bug corrigido:** toque duplo rapido no botao "Pagar" antes do `isPending` atualizar disparava dois `POST /bookings` para o mesmo slot. Adicionado `submittingRef` (useRef) como guard atomico: segunda chamada e ignorada se a primeira ainda esta em andamento. Guard liberado apos 2s ou em caso de erro.

### fut-api

#### `src/modules/mail/mail.service.ts` — desabilitar email sem credenciais
- `MailService` agora verifica no construtor se `MAIL_USER` e `MAIL_PASS` estao configurados (diferentes dos placeholders do `.env.example`).
- Se nao configurados, loga um unico WARN na inicializacao e pula silenciosamente todos os envios.
- Elimina o WARN repetido `Mail to ... failed: Error: Invalid login` que aparecia em toda reserva/login em ambiente de desenvolvimento.
- Para habilitar email: obtenha credenciais em https://mailtrap.io e preencha `MAIL_USER` e `MAIL_PASS` no `.env`.

---

## [2026-05-22] – Integração Stripe: PIX real, cartão, webhook e saque do dono

### Arquitetura de pagamentos

Gateway integrado: **Stripe** (sandbox). O `MockPaymentProvider` foi substituído por `StripePaymentProvider` implementando a mesma interface `PaymentProvider`, sem impacto nos demais módulos. Campos novos no schema (`qrCodeUrl` em `Payment`, `stripeCustomerId` e `stripeAccountId` em `User`) exigem `npx prisma db push && npx prisma generate`.

---

### fut-api

#### `prisma/schema.prisma` — campos Stripe
- `Payment.qrCodeUrl String?` — URL da imagem PNG do QR Code gerado pelo Stripe.
- `User.stripeCustomerId String?` — ID do customer Stripe (cus_...) para cobranças.
- `User.stripeAccountId String?` — ID da conta Stripe Connect Express (acct_...) para saques do dono.

#### `src/modules/payments/providers/stripe.provider.ts` — novo provider real
- Substitui `MockPaymentProvider` por implementação real do Stripe.
- **PIX:** `PaymentIntent` com `payment_method_types: ['pix']` + `confirm: true`. Retorna `qrCode` (brcode copia-e-cola) e `qrCodeUrl` (imagem PNG) extraídos de `next_action.pix_display_qr_code`.
- **Cartão:** `PaymentIntent` com `payment_method_types: ['card']` + `confirm: true`. Usa `providerToken` (PaymentMethod ID `pm_...`) salvo no cadastro do cartão.
- **Reembolso:** `stripe.refunds.create` com `payment_intent` e valor em centavos.

#### `src/modules/payments/payments.service.ts` — webhook + status polling
- `checkout()` salva `qrCodeUrl` junto com `qrCode` no `Payment`.
- `getPaymentStatus(paymentId)` — novo método retornando `{ status, paidAt }` para polling do app.
- `handleStripeWebhook(rawBody, signature)` — verifica assinatura HMAC (`STRIPE_WEBHOOK_SECRET`), processa `payment_intent.succeeded` (marca `paid`, credita carteira do dono) e `payment_intent.payment_failed` (marca `failed`). Idempotente: ignora eventos duplicados.

#### `src/modules/payments/payments.controller.ts` — endpoints novos
- `GET /payments/:id/status` — retorna status atual do pagamento (usado pelo polling PIX).
- `POST /payments/webhook/stripe` — endpoint público (`@Public`) sem JWT, autenticado via `stripe-signature`. Requer `rawBody: true` no NestFactory.

#### `src/main.ts` — rawBody habilitado
- `NestFactory.create(AppModule, { rawBody: true })` — necessário para que o Stripe possa verificar a assinatura HMAC do webhook.

#### `src/modules/wallet/wallet.service.ts` — saque via Stripe Connect
- `requestPayout()` agora cria (ou reutiliza) uma conta Stripe Connect Express para o dono.
- Executa `stripe.transfers.create` transferindo o valor da conta da plataforma para a conta do dono.
- Em sandbox, se o transfer falhar por falta de saldo na plataforma, o payout é registrado localmente sem interromper o fluxo (warn no log).
- `stripeAccountId` persistido no `User` para reuso em saques futuros.

#### `.env` — novas variáveis obrigatórias
```
STRIPE_SECRET_KEY=sk_test_...       # Dashboard → Developers → API Keys
STRIPE_WEBHOOK_SECRET=whsec_...     # Dashboard → Webhooks → signing secret
```

---

### fut-app

#### `services/payments.service.ts` — campos e método de status
- `CheckoutResponse` agora inclui `qrCodeUrl?: string`.
- Novo método `getStatus(paymentId)` chamando `GET /payments/:id/status` — usado pelo polling da tela PIX.

#### `app/(player)/booking/new.tsx` — tela de pagamento reescrita
- **Bug corrigido:** params `startTime`/`endTime` não eram lidos (o componente lia `time` que não existia) → `startsAt = "...Tundefined:00"` → erro 400 no backend.
- **Bug corrigido:** `endsAt` era calculado como `startsAt + 1h` fixo, ignorando o slot de término escolhido.
- **Bug corrigido:** tela de resumo exibia "1 hora" hardcoded e horário como `undefined`.
- **QR Code real:** imagem PNG do Stripe exibida via `<Image source={{ uri: qrCodeUrl }} />` em vez de texto placeholder.
- **Polling automático:** após gerar o PIX, um `setInterval` a cada 3s chama `getStatus()`. Quando `status === 'paid'` (confirmado pelo webhook Stripe), cancela o polling e navega para a tela de sucesso.
- **Código copia-e-cola:** exibe o brcode PIX com label "Toque para copiar".
- **Duração real:** calculada dinamicamente de `startTime` → `endTime` (ex: "2h", "1h30min", "30min").
- Fluxo **cartão** confirmado imediatamente pelo Stripe sem polling.
- Tela de sucesso navega automaticamente para `/bookings` em 2s.

---

### Como configurar o webhook em desenvolvimento

```bash
# Instale o Stripe CLI
brew install stripe/stripe-cli/stripe
# Autentique
stripe login
# Redirecione eventos para o servidor local
stripe listen --forward-to localhost:3000/payments/webhook/stripe
# O CLI exibe o STRIPE_WEBHOOK_SECRET — cole no .env
```

---

## [2026-05-22] – Correção: criação de reserva retornava erro 400

### Causa raiz
`app/(player)/booking/new.tsx` recebia `startTime` e `endTime` via router params, mas o componente lia apenas `time` (campo inexistente). Resultado: `startsAt = "${date}Tundefined:00"` — string inválida rejeitada pelo `@IsDateString()` do DTO no backend com HTTP 400.

### fut-app

#### `app/(player)/booking/new.tsx`
- `useLocalSearchParams` atualizado para ler `startTime` e `endTime` (alinhado com o que `[id].tsx` envia).
- `startsAt` = `${date}T${startTime}:00`; `endsAt` = `${date}T${endTime}:00`.
- Resumo exibe `startTime → endTime` e duração calculada dinamicamente.

---

## [2026-05-22] – Bloqueio de horários passados ao reservar no mesmo dia

### fut-app

#### `app/(player)/courts/[id].tsx` — `buildMinuteSlots` com `isToday`
- Nova assinatura: `buildMinuteSlots(availability, isToday = false)`.
- Quando `isToday = true`, slots cujo intervalo de 30 min já encerrou (`m + 30 <= nowMinutes`) são marcados como `available: false`.
- Usa hora local do dispositivo (`new Date().getHours() * 60 + getMinutes()`), correto para o fuso do jogador.
- Call site: `buildMinuteSlots(availability, selectedDate === getTodayString())`.

---

## [2026-05-19] – Interface do jogador: listagem de quadras, filtros e detalhe da quadra

### fut-app

#### `app/(player)/index.tsx` — quadras não retornavam + filtros comprimidos
- **Bug principal:** `courtsService.list()` retorna `Court[]` diretamente, mas o código acessava `data?.data` (estrutura de paginação) → array sempre `undefined`. Corrigido usando novo método `listAll()` com tipo correto.
- `radius: 20000` (km) substituído por `radius: 50` km, aplicado somente quando a geolocalização está disponível. Sem localização, todas as quadras ativas são retornadas sem filtro de distância.
- Filtros de esporte: `paddingVertical` insuficiente causava chips verticalmente comprimidos. Corrigido para `paddingVertical: spacing.sm` com `alignItems: 'center'`.

#### `components/ui/Chip.tsx` — tamanho mínimo e texto cortado
- `paddingVertical` aumentado de `spacing.xs + 1` para `8` fixo.
- Adicionado `alignSelf: 'flex-start'` para o chip não esticar dentro de scroll horizontal.
- `flexShrink: 0` no texto para evitar compressão do label.

#### `services/courts.service.ts` — método `listAll` + tipagem de `getAvailability`
- Adicionado `listAll(filters?)` que faz `GET /courts` e retorna `Court[]` diretamente (sem wrapper de paginação), refletindo o que o backend realmente retorna.
- Tipagem de `getAvailability` corrigida: antes declarava `Promise<TimeSlot[]>`, agora reflete o objeto real `{ date, open, openTime, closeTime, pricePerHour, unavailable[] }`.

#### `components/courts/CourtCard.tsx` — fotos com URL relativa não exibiam
- Adicionado `resolvePhotoUrl()` na foto de capa do card para converter URLs relativas (`/storage/...`) em absolutas, cobrindo fotos cadastradas antes da correção do endpoint.

#### `app/(player)/courts/[id].tsx` — crash ao abrir detalhe da quadra
- **Bug:** `useQuery` de disponibilidade recebia o objeto `{ open, openTime, ... }` mas o código tentava `.map()` direto sobre ele → `TypeError: slots.map is not a function`.
- Corrigido: query agora recebe `availability` (o objeto). Adicionada função `buildSlots(availability)` que gera `Slot[]` de 1h entre `openTime` e `closeTime`, marcando como indisponíveis os slots que sobrepõem janelas de bloqueios ou reservas confirmadas.
- Interface local `Slot { time, price, available }` substituiu o import de `TimeSlot` do backend.
- Fotos do carrossel passam por `resolvePhotoUrl` para funcionar com URLs relativas e absolutas.

---

## [2026-05-19] – Exclusão de conta bancária

### fut-api

#### `wallet.service.ts` — método `deleteBankAccount`
- Novo método que verifica ownership antes de deletar — lança `NotFoundException` se a conta não pertencer ao usuário autenticado.

#### `wallet.controller.ts` — endpoint `DELETE /wallet/bank-accounts/:id`
- Novo endpoint protegido com `@Roles('owner')`.

### fut-app

#### `services/wallet.service.ts` — método `deleteBankAccount`
- Novo método `deleteBankAccount(id)` chamando `DELETE /wallet/bank-accounts/:id`.

#### `app/(owner)/finance.tsx` — botão de excluir conta bancária
- Ícone de lixeira (Trash2) adicionado no lado direito de cada card de conta bancária.
- Ao tocar, exibe `Alert` de confirmação antes de deletar.
- `deleteBankMutation` invalida `['bank-accounts']` após sucesso.

---

## [2026-05-19] – Seção de fotos da quadra readicionada + correções de upload

### fut-api

#### `courts.controller.ts` — endpoint `POST /courts/:id/photos` corrigido
- `destination` do multer corrigido de `./storage/courts` para `path.join(process.cwd(), 'storage', 'courts')` — evita mismatch entre CWD e `__dirname` em produção.
- URL salva agora é absoluta (`http://host/storage/courts/arquivo.jpg`) via `req.protocol + req.get('host')`.
- `fileFilter` aceita qualquer `image/*`.
- `BadRequestException` quando nenhum arquivo é recebido.

#### `prisma/schema.prisma` — campo `createdAt` em `CourtPhoto`
- Adicionado `createdAt DateTime @default(now())` ao modelo `CourtPhoto`.
- Permite ordenar fotos por data de inserção para exibir sempre a mais antiga presente.
- **Requer:** `npx prisma generate` após `npx prisma db push`.

#### `courts.service.ts` — fotos ordenadas por `createdAt asc`
- Todos os `include: { photos: ... }` agora usam `orderBy: { createdAt: 'asc' }`, garantindo que o backend sempre devolve a foto mais antiga (primeira adicionada ainda presente) como `photos[0]`.
- Corrigida inferência de tipo em `findAll` (tipo explícito `CourtRow[]`) que causava erros TS2339 em `schedules`.

### fut-app

#### `services/courts.service.ts` — `uploadPhoto` via `fetch` nativo
- Substituído `axios.post` por `fetch` nativo — mesmo padrão do avatar, evita problema de boundary multipart no React Native.
- `mimeType` recebido como parâmetro opcional do caller.

#### `app/(owner)/courts/[id].tsx` — seção de fotos readicionada
- Card **Fotos (N/5)** reinserido entre Informações e Horários.
- Grid 3 colunas com proporção 4:3 e botão ✕ para remover cada foto.
- Botão "Adicionar" com ícone de câmera, desabilitado ao atingir 5 fotos.
- Estado vazio com área pontilhada clicável.
- `mediaTypes: 'images'` (API nova do expo-image-picker).
- `asset.mimeType` passado junto para garantir tipo correto no upload.

#### `app/(owner)/courts/index.tsx` — thumbnail usa primeira foto presente
- Removido `sort((a,b) => a.position - b.position)` que não funcionava (todas as fotos têm `position: 0`).
- Agora usa `photos[0]` diretamente — backend já garante a ordem por `createdAt asc`.

---

## [2026-05-18] – Foto de perfil: upload, exibição e correções de multipart

### fut-api

#### `auth.controller.ts` — endpoint `POST /me/avatar`
- Novo endpoint autenticado que recebe `multipart/form-data` com campo `file`.
- Salva o arquivo em `<cwd>/storage/avatars/` via multer `diskStorage` com nome único baseado em timestamp.
- Retorna a URL absoluta (`http://host/storage/avatars/arquivo.jpg`) salva no `avatarUrl` do usuário.
- `fileFilter` aceita qualquer `image/*` (antes usava regex restrita que rejeitava `image/jpg`, variante não-padrão mas enviada por alguns clientes iOS).
- `BadRequestException` explícita quando nenhum arquivo é recebido.

#### `app.module.ts` — `ServeStaticModule` com `process.cwd()`
- `rootPath` alterado de `join(__dirname, '..', 'storage')` para `join(process.cwd(), 'storage')`.
- `__dirname` aponta para `dist/` em produção, causando mismatch com o multer que salva em `<cwd>/storage/`. Agora ambos usam o mesmo caminho absoluto.

### fut-app

#### `services/auth.service.ts` — `uploadAvatar` via `fetch` nativo
- Substituído `axios.post` por `fetch` nativo para o upload multipart.
- `axios` com instância que tem `Content-Type: application/json` default não sobrescreve o boundary do multipart corretamente no React Native, fazendo o servidor não conseguir parsear o arquivo.
- `fetch` define `Content-Type: multipart/form-data; boundary=...` automaticamente quando recebe um `FormData` como body.
- Token lido diretamente de `useAuthStore.getState().accessToken`.
- `mimeType` recebido do caller (asset do expo-image-picker) como parâmetro opcional para garantir o tipo correto.
- URI tratada para remover query params (ex: `ImagePicker/xxx.jpg?...`) antes de extrair o filename.

#### `app/(owner)/profile.tsx` e `app/(player)/profile.tsx` — botão de foto de perfil
- Avatar envolto em `TouchableOpacity` com badge de câmera (📷) no canto inferior direito.
- Ao tocar, abre `ImagePicker` com crop quadrado (1:1), qualidade 0.8.
- `mediaTypes: 'images'` substitui o deprecated `ImagePicker.MediaTypeOptions.Images`.
- `asset.mimeType` passado junto com a URI para garantir tipo correto no upload.
- Texto "Atualizando foto..." exibido enquanto o upload está em andamento.
- `setUser(updated)` ao concluir — avatar atualiza imediatamente na tela sem reload.

---

## [2026-05-13] – Correção: cadastro e listagem de quadras falhavam (token não enviado)

### Causa raiz
Quando o usuário faz login **sem marcar "Lembrar de mim"**, o `accessToken` e `refreshToken` são mantidos apenas em memória (Zustand store) e **não são persistidos** no `SecureStore`/`localStorage`. O interceptor do axios buscava o token somente do storage — portanto toda requisição ia sem `Authorization`, recebia 401, e o app fazia signOut automático. Isso quebrava tanto o cadastro (`POST /courts`) quanto a listagem (`GET /courts?ownerId=...`).

### fut-app

#### `services/api.ts` — interceptor lê token do store em memória primeiro
- O interceptor de request agora usa `useAuthStore.getState().accessToken` como fonte primária, com fallback para `storage.getItem('accessToken')`.
- O interceptor de refresh também usa `useAuthStore.getState().refreshToken` como fonte primária.
- Ao renovar o token, atualiza o store em memória via `signIn(... false)` e só persiste no storage se o usuário já tinha um token salvo (ou seja, tinha usado "Lembrar de mim").
- Em caso de falha no refresh, chama `useAuthStore.getState().signOut()` para limpar o estado de forma consistente.

#### `app/(owner)/courts/new.tsx` — `defaultValues` completo
- Adicionados todos os campos ao `defaultValues` do `useForm` (`name`, `sport`, `description`, etc.) para garantir que nenhum campo inicie como `undefined` no react-hook-form.

---

## [2026-05-13] – Correção: cadastro de quadra falhava silenciosamente + listagem não atualizava

### fut-api

#### `CreateCourtDto` — `@Type(() => Number)` em `latitude`/`longitude`
- Adicionado decorator `@Type(() => Number)` da `class-transformer` nos campos `latitude` e `longitude`.
- O `ValidationPipe` com `transform: true` precisa do `@Type` para converter corretamente valores numéricos recebidos via JSON.
- Sem isso, em certos contextos o `@IsNumber()` rejeitava o campo, causando falha silenciosa no cadastro.

#### `courts.service.ts` — `mapsUrl` e `rules` vazios convertidos para `undefined`
- `dto.mapsUrl || undefined` e `dto.rules || undefined`: string vazia `''` agora é salva como `NULL` no Prisma, evitando inconsistência com o campo `String?`.

#### `GlobalExceptionFilter` — resposta de erro padronizada com campo `message`
- Antes, o filtro retornava `{ error: <objeto> }`. O app lia `response.data.message` e não encontrava, exibindo sempre a mensagem genérica.
- Agora retorna `{ message: string }` — se for `BadRequestException` do ValidationPipe (array de erros), usa o primeiro item; se for string direta, usa como está.
- Todos os erros da API agora chegam legíveis no app (ex: "Você já possui uma quadra com esse nome.").

### fut-app

#### `new.tsx` — `invalidateQueries` com `exact: false`
- O `invalidateQueries({ queryKey: ['owner-courts'] })` não invalidava a query `['owner-courts', userId]` usada na tela de listagem.
- Adicionado `exact: false` para invalidar qualquer query cujo key começa com `['owner-courts']`.
- Resultado: após cadastrar uma quadra, a listagem atualiza imediatamente ao voltar.

---

## [2026-05-13] – Correção: internal server error ao salvar conta bancária

### fut-api

#### Causa raiz
O `CreateBankAccountDto` era uma classe simples sem decorators do `class-validator`. Com `whitelist: true` no `ValidationPipe`, todos os campos sem `@IsString()` / `@IsOptional()` eram removidos antes de chegar no service. O Prisma tentava criar o registro sem os campos obrigatórios (`holderName`, `document`, etc.) e lançava erro de constraint → 500.

#### `src/modules/wallet/dto/create-bank-account.dto.ts` — criado
- Novo arquivo com `CreateBankAccountDto` com todos os decorators corretos: `@IsString()`, `@MinLength()`, `@IsOptional()`, `@ApiProperty()`.

#### `wallet.service.ts` e `wallet.controller.ts` — imports corrigidos
- Ambos passaram a importar `CreateBankAccountDto` do novo arquivo DTO.
- Removida a definição inline da classe do `wallet.service.ts`.

---

## [2026-05-13] – Finanças: dropdown de banco e tipo de conta + validação no cadastro

### fut-app

#### `app/(owner)/finance.tsx` — nova conta bancária reformulada
- Campo "Banco" substituído por `SelectPicker` com busca, listando 17 bancos principais do Brasil (Nubank, Itaú, Bradesco, Santander, BB, Caixa, Inter, C6, BTG, etc.).
- Campo "Tipo" substituído por `SelectPicker` com as opções "Conta Corrente" e "Conta Poupança".
- Validação manual implementada (sem react-hook-form) antes de submeter:
  - Nome do titular: mínimo 2 caracteres
  - CPF/CNPJ: mínimo 11 dígitos numéricos
  - Banco: obrigatório (dropdown)
  - Agência: obrigatória
  - Número da conta: obrigatório
  - Tipo de conta: obrigatório (dropdown)
  - Chave PIX: opcional
- Erros exibidos inline abaixo de cada campo com borda vermelha.
- Modal migrado de `transparent` overlay para `pageSheet` (mesmo padrão dos outros modais do app).
- CPF/CNPJ sanitizado (só dígitos) antes de enviar à API.
- Campo PIX com `autoCapitalize="none"`.
- Card de conta exibe "CC" ou "CP" conforme o tipo.

---

## [2026-05-13] – Edição de quadra + remoção da seção de fotos

### fut-app

#### `app/(owner)/courts/[id].tsx` — modal de edição completo
- Seção de fotos removida da tela de detalhe.
- Botão "Editar" (ícone lápis) adicionado no cabeçalho do card Informações.
- Ao tocar, abre modal pageSheet com todos os campos editáveis:
  - Nome, Esporte (chips), Descrição, Endereço, Estado (SelectPicker com busca), Cidade (SelectPicker dependente do estado), CEP, Comodidades (chips), Regras, Link Google Maps.
- O form é pré-preenchido com os dados atuais da quadra via `useEffect`.
- Ao trocar o estado, a cidade é resetada automaticamente.
- Validações: nome mínimo 2 chars, esporte obrigatório, endereço obrigatório, cidade obrigatória, URL do Maps deve ser http(s) se preenchida.
- Ao salvar, chama `PATCH /courts/:id` e invalida as queries `['court', id]` e `['owner-courts']`.
- Link Google Maps exibido na seção Informações (abre no app de mapas via `Linking.openURL`).

---

## [2026-05-13] – Correção: fotos não exibiam + link Google Maps na tela de detalhe

### fut-app

#### `app/(owner)/courts/[id].tsx` — fotos renderizadas com `ImageBackground`
- Substituído `<View> + <Image>` por `<ImageBackground>` nos thumbnails de foto.
- Com `newArchEnabled: true` (New Architecture do React Native), o componente `Image` dentro de um `View` com `overflow: hidden` não renderizava corretamente quando havia filhos com `position: absolute`. O `ImageBackground` resolve isso nativamente.
- O botão de remover foto continua funcionando como filho direto do `ImageBackground`.

#### `app/(owner)/courts/[id].tsx` — link Google Maps na seção Informações
- Exibe "📍 Ver no Google Maps" quando a quadra tem `mapsUrl` preenchido.
- Ao tocar, abre o link no browser/app de mapas do dispositivo via `Linking.openURL`.

---

## [2026-05-13] – Correção: fotos da quadra não apareciam (403 Forbidden)

### fut-api

#### `JwtAuthGuard` — rotas `/storage/*` liberadas sem token
- O guard JWT global bloqueava requisições aos arquivos estáticos (fotos) com 403, pois o `Image` do app não envia o header `Authorization`.
- Adicionado bypass em `canActivate`: qualquer `req.path` iniciando com `/storage/` é permitido sem autenticação.
- Arquivo: `src/common/guards/jwt-auth.guard.ts`.

### fut-app

#### `Image` — `resizeMode="cover"` adicionado às fotos
- Adicionado `resizeMode="cover"` no componente `Image` dos thumbnails de foto na tela de detalhe da quadra.
- Arquivo: `app/(owner)/courts/[id].tsx`.

---

## [2026-05-05] – Google Maps, galeria de fotos e bloqueio de disponibilidade

### fut-api

#### Campo `mapsUrl` no modelo `Court`
- Adicionado `mapsUrl String?` no `schema.prisma`.
- Adicionado `mapsUrl` no `CreateCourtDto` e no `create` do service.
- **Requer migração manual:** `npx prisma db push` na pasta `fut-api`.

#### Endpoint `DELETE /courts/:id/photos/:photoId`
- Remove uma foto da quadra com validação de `assertOwner`.
- O `addPhoto` agora também valida o limite de 5 fotos no banco antes de criar.

#### Disponibilidade — bloqueios impedem reservas
- `getAvailability` reformulado: em vez de gerar slots de 1 minuto (que travaria), retorna o horário de funcionamento do dia + lista de janelas `unavailable` (blocks + bookings pendentes/confirmados).
- O app consome essa estrutura para renderizar o seletor de horário sem slots bloqueados.

---

### fut-app

#### Formulário nova quadra — campo Google Maps
- Campo "Link Google Maps (opcional)" adicionado após Regras.
- Validação Zod: deve ser URL válida ou vazio.
- Campo limpo junto com o resto do formulário após cadastro.

#### Tela de detalhe — seção de fotos (máx. 5)
- Nova seção "Fotos (X/5)" exibida entre Informações e Horários.
- Botão "Adicionar" e placeholder clicável ao tocar abre `expo-image-picker` (galeria).
- Fotos exibidas em scroll horizontal como thumbnails 90×90.
- Cada foto tem botão de lixeira (canto superior direito) com confirmação antes de remover.
- Quando 5 fotos já foram adicionadas, o botão de adicionar some e exibe alerta se tentar.
- Solicitação de permissão de galeria antes de abrir o picker.

#### `types/index.ts`
- `mapsUrl?: string` adicionado ao tipo `Court`.

#### `courts.service.ts` (app)
- Método `removePhoto(courtId, photoId)` adicionado.

---

## [2026-05-05] – Horários e bloqueios: UX refinada

### fut-api
- `slotMinutes` passa a ter default `1` no DTO (campo interno, não exposto na UI).

### fut-app

#### Modal de horários — bloqueio de dias duplicados
- Dias que já possuem horário cadastrado aparecem em cinza e não podem ser selecionados.
- Os atalhos "Seg–Sex", "Sáb–Dom" e "Todos os dias" ignoram automaticamente dias já configurados.
- Se o usuário tentar salvar um dia já cadastrado (via manipulação de estado), exibe alerta com o nome dos dias conflitantes.
- Hint visual: "Dias em cinza já possuem horário cadastrado."

#### Modal de horários — campo slot removido
- Removido dropdown de duração de slot da UI.
- O slot é enviado como `1` para a API (sem impacto na reserva, pois o jogador escolhe a duração).

#### Modal de bloqueio — formatação de data
- Campo de data agora aceita entrada numérica e formata automaticamente para `DD/MM/AAAA` enquanto o usuário digita.
- Conversão para ISO (`AAAA-MM-DD`) feita internamente antes de enviar à API.
- Valor inicial pré-preenchido com a data de hoje no formato `DD/MM/AAAA`.

---

## [2026-05-05] – Horários: endpoints ausentes, seleção múltipla de dias e formatação de preço

### fut-api

#### Endpoints `GET /courts/:id/schedules` e `GET /courts/:id/blocks` adicionados
- O controller só tinha `POST` para ambos — o app chamava `GET` e recebia 404, fazendo a listagem aparecer vazia.
- `getSchedulesByCourtId` retorna horários ordenados por `dayOfWeek`.
- `getBlocksByCourtId` retorna bloqueios ordenados por `startsAt`.

---

### fut-app

#### Modal de horários — seleção múltipla de dias
- Substituído dropdown de dia único por chips circulares para cada dia (Dom–Sáb).
- Atalhos rápidos: "Seg–Sex", "Sáb–Dom", "Todos os dias", "Limpar".
- Ao salvar, cria um horário por dia selecionado em sequência (`mutateAsync` em loop).
- Slots disponíveis: 60, 90, 120 e 150 minutos (removido 30min).

#### Formatação de preço ao digitar
- Campo de preço formata automaticamente enquanto o usuário digita: `150` → `1,50` → `15,00` → `150,00`.
- Internamente converte para float antes de enviar à API.

#### Horários de meia-noite
- `TIME_OPTIONS` estendido até `00:00` (meia-noite), exibido como `00:00 (meia-noite)`.

#### Correção de IP no `.env` do app
- `EXPO_PUBLIC_API_URL` atualizado de `192.168.0.78` para `172.20.10.2` após troca de rede (Wi-Fi → hotspot).
- Reiniciar com `npx expo start --clear` sempre que o IP mudar.

---

## [2026-05-05] – Quadras: correções e melhorias

### fut-api

#### `UpdateCourtDto` — campo `status` adicionado
- `UpdateCourtDto` estendia apenas `PartialType(CreateCourtDto)`, que não incluía `status`.
- Adicionado `status?: 'active' | 'inactive'` com validação `@IsIn`.
- **Efeito:** botão de ativar/desativar quadra passou a funcionar.

#### Validação de quadra duplicada
- Ao criar uma quadra, a API agora busca todas as quadras ativas do dono e compara os nomes (case-insensitive, trim) em memória — necessário pois SQLite não suporta `mode: 'insensitive'` do Prisma (exclusivo de PostgreSQL).
- Retorna `400 Bad Request` com mensagem `"Você já possui uma quadra com esse nome."` em caso de duplicata.

#### Novos endpoints de remoção
- `DELETE /courts/:id/blocks/:blockId` — remove um bloqueio da quadra.
- `DELETE /courts/:id/schedules/:scheduleId` — remove um horário de funcionamento.
- Ambos validam `assertOwner` antes de deletar.

#### Correção de erro de TypeScript
- Removido `mode: 'insensitive'` da query Prisma (incompatível com SQLite/`StringFilter<"Court">`).
- Substituído por comparação em memória após `findMany`.

---

### fut-app

#### Formulário de nova quadra — limpeza após cadastro
- Após cadastro com sucesso, `reset()` do react-hook-form redefine todos os campos para os valores padrão.
- `selectedSport` e `selectedAmenities` também são resetados.
- Erros da API (ex: nome duplicado) são exibidos no `Alert` com a mensagem real do backend.

#### Dropdowns de Estado e Cidade
- Campos de UF e Cidade substituídos pelo novo componente `SelectPicker`.
- Ao trocar o estado, a cidade é resetada automaticamente.
- Campo Cidade fica desabilitado até um estado ser selecionado.
- Ambos os campos têm busca por texto.
- Criado `constants/brazil-locations.ts` com todos os 27 estados e principais cidades.

#### Tela de detalhe da quadra — botão desativar/ativar
- Agora passa `status` corretamente no body do `PATCH /courts/:id`.
- Exibe `Alert` de confirmação antes de executar a ação.
- Exibe erro em caso de falha na requisição.

#### Horários de funcionamento — modal de cadastro
- Botão "Adicionar" na seção de horários abre um modal com:
  - Dropdown de dia da semana
  - Dropdown de horário de abertura (intervalos de 30 min, das 06h às 22h)
  - Dropdown de horário de fechamento
  - Dropdown de duração do slot (30, 60, 90, 120 min)
  - Campo de preço por hora
- Validação: preço obrigatório e horário de abertura anterior ao fechamento.
- Cada horário exibe ícone de lixeira com confirmação para remoção.

#### Bloqueios — modal de cadastro
- Botão "Adicionar" na seção de bloqueios abre um modal com:
  - Campo de data (formato AAAA-MM-DD)
  - Dropdown de horário de início
  - Dropdown de horário de fim
  - Campo de motivo (opcional)
- Validação: data obrigatória e horário início anterior ao fim.
- Cada bloqueio exibe ícone de lixeira com confirmação para remoção.

#### `courts.service.ts` (app)
- Adicionados métodos `removeSchedule` e `addSchedule` ao service do app.

---

## [2026-05-04] – Setup inicial e autenticação

### fut-api / fut-app
- Métodos de cadastro, login e logout funcionando para jogador e dono de quadra.
- Correção do `baseURL` no Expo Go: `localhost` substituído pelo IP da máquina na rede local.

### fut-app – Listagem de quadras do dono
- `GET /courts` agora aceita `ownerId` como filtro.
- App usa `listByOwner(ownerId)` em vez de filtrar client-side sobre lista paginada.
- Corrigido `data?.data` → `data ?? []` (resposta é array, não objeto paginado).

### fut-app – Esportes disponíveis
- Removidos: Basquete, Tênis, Vôlei.
- Adicionado: Futevôlei.
- Lista final: Futebol, Society, Futsal, Futevôlei.
- Atualizado tanto no formulário de cadastro (dono) quanto no filtro de busca (jogador).
