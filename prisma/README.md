# Banco de dados (Prisma)

## Setup em máquina nova

```bash
npm install          # roda prisma generate (postinstall)
npx prisma migrate deploy
npm run prisma:seed  # opcional — dados de teste
```

## Depois de alterar `schema.prisma`

1. Crie migração: `npx prisma migrate dev --name descricao_da_mudanca`
2. Ou em CI/prod: `npm run db:migrate`
3. Sempre: `npm run prisma:generate` (também roda no `npm run start:dev`)

## Verificar se está tudo alinhado

```bash
npm run db:check
```

Saída esperada: exit code **0** (sem diff entre migrações e schema).

## E-mail (Mailtrap)

1. Crie conta em https://mailtrap.io
2. **Sandboxes** → abra a inbox → aba **Integration** → **SMTP**
3. Copie **Username** e **Password** para o `.env`:
   ```env
   MAIL_HOST=sandbox.smtp.mailtrap.io
   MAIL_PORT=2525
   MAIL_USER=...
   MAIL_PASS=...
   ```
4. Reinicie a API — no log deve aparecer `SMTP conectado`
5. Teste (logado): `POST /mail/test` ou crie uma conta nova (e-mail de boas-vindas)

Os e-mails aparecem na inbox do Mailtrap, não na caixa real.

## Problemas comuns

| Sintoma | Causa | Solução |
|--------|--------|---------|
| `Unknown argument paymentStatus` | Client desatualizado | `npm run prisma:generate` e reinicie a API |
| `duplicate column name` na migrate | Banco já atualizado manualmente | `npx prisma migrate resolve --applied NOME_DA_MIGRACAO` |
| Drift / reset pedido | Histórico de migrações ≠ banco | Em **dev**: `npx prisma migrate reset` (apaga dados) |

**Não** use só `db push` em produção — prefira migrações versionadas (`migrate dev` / `migrate deploy`).
