import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { networkInterfaces } from 'os';
import { AppModule } from './app.module';

function getLanAddresses(): string[] {
  const nets = networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface ?? []) {
      const family = String(net.family);
      if ((family === 'IPv4' || family === '4') && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

async function bootstrap() {
  // rawBody: true necessario para verificar assinatura do webhook Stripe
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({ origin: process.env.APP_ORIGIN ?? '*' });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
  );

  const config = new DocumentBuilder()
    .setTitle('FutMatch API')
    .setDescription('Plataforma de intermediacao de espacos esportivos')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  console.log(`FutMatch API running on http://${host}:${port}`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log('Acesso na rede local (use no EXPO_PUBLIC_API_URL do fut-app):');
    for (const ip of lan) console.log(`  → http://${ip}:${port}`);
  }
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
