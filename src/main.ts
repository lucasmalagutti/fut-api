import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

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

  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  console.log(`FutMatch API running on http://${host}:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
