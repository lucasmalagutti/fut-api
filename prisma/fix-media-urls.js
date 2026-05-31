/**
 * Converte URLs absolutas antigas (outro IP) para caminhos /storage/...
 * Uso: node prisma/fix-media-urls.js
 */
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

function normalize(url) {
  if (!url) return null;
  const t = url.trim();
  if (t.startsWith('/storage/')) return t;
  try {
    const u = new URL(t);
    if (u.pathname.startsWith('/storage/')) return u.pathname;
  } catch {
    /* ignore */
  }
  return t;
}

const dbUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const dbPath = path.resolve(dbUrl.replace(/^file:/, ''));
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  let fixed = 0;

  const users = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { id: true, avatarUrl: true },
  });
  for (const u of users) {
    const next = normalize(u.avatarUrl);
    if (next && next !== u.avatarUrl) {
      await prisma.user.update({ where: { id: u.id }, data: { avatarUrl: next } });
      fixed++;
    }
  }

  const photos = await prisma.courtPhoto.findMany({ select: { id: true, url: true } });
  for (const p of photos) {
    const next = normalize(p.url);
    if (next && next !== p.url) {
      await prisma.courtPhoto.update({ where: { id: p.id }, data: { url: next } });
      fixed++;
    }
  }

  console.log(`✅ ${fixed} URL(s) de mídia normalizada(s) para caminho /storage/...`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
