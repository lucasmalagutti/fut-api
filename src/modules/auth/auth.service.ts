import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { normalizeMediaUrl } from '../../common/utils/media-url';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const BCRYPT_ROUNDS = 10;
const resetTokens = new Map<string, { userId: string; expiresAt: Date }>();

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  async signup(dto: SignupDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
        phone: dto.phone,
        status: 'active',
        wallet: { create: { balance: 0 } },
      },
    });

    await this.mail.sendWelcome(user.email, user.name).catch(() => null);
    return this.buildTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'deleted') throw new ForbiddenException('Account not found');
    if (user.status === 'inactive' || user.status === 'banned') {
      throw new ForbiddenException(user.banReason ?? 'Account suspended');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.buildTokens(user, dto.keepConnected);
  }

  async refresh(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') throw new UnauthorizedException();
    return this.buildTokens(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex');
    resetTokens.set(token, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    await this.mail.sendPasswordReset(user.email, token).catch(() => null);
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('Passwords do not match');
    }
    const entry = resetTokens.get(dto.token);
    if (!entry || entry.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: entry.userId },
      data: { passwordHash },
    });
    resetTokens.delete(dto.token);
  }

  private buildTokens(user: User, keepConnected = true) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    // Mesmos fallbacks das strategies — sem .env o jwt.sign() quebra com 500
    const accessSecret =
      this.config.get<string>('JWT_ACCESS_SECRET') ?? 'jwt_access_secret_fallback';
    const refreshSecret =
      this.config.get<string>('JWT_REFRESH_SECRET') ?? 'jwt_refresh_secret_fallback';

    const accessToken = this.jwt.sign(payload, {
      secret: accessSecret,
      expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
    });

    const refreshToken = keepConnected
      ? this.jwt.sign(payload, {
          secret: refreshSecret,
          expiresIn: this.config.get('JWT_REFRESH_TTL', '7d'),
        })
      : undefined;

    return { accessToken, refreshToken, user: this.sanitize(user) };
  }

  private sanitize(user: User) {
    const { passwordHash: _, ...safe } = user;
    return {
      ...safe,
      avatarUrl: normalizeMediaUrl(safe.avatarUrl) ?? safe.avatarUrl,
    };
  }
}
