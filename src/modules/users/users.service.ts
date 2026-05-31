import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { normalizeMediaUrl } from '../../common/utils/media-url';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async update(userId: string, dto: UpdateUserDto) {
    const data = { ...dto };
    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = normalizeMediaUrl(dto.avatarUrl) ?? dto.avatarUrl;
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    const { passwordHash: _, ...safe } = user;
    return {
      ...safe,
      avatarUrl: normalizeMediaUrl(safe.avatarUrl) ?? safe.avatarUrl,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { message: 'Password updated' };
  }

  async deleteAccount(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new BadRequestException('Invalid password');

    await this.prisma.user.update({ where: { id: userId }, data: { status: 'deleted' } });
    return { message: 'Account deleted' };
  }

  // Bloquear conta por PIX pendente
  async blockUser(userId: string, reason: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { blockedAt: new Date(), blockReason: reason },
    });
  }

  // Desbloquear conta apos quitacao
  async unblockUser(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { blockedAt: null, blockReason: null },
    });
  }

  async findAll(query: { q?: string; role?: string; status?: string; order?: string }) {
    const users = await this.prisma.user.findMany({
      where: {
        status: { not: 'deleted' },
        ...(query.role && { role: query.role as any }),
        ...(query.status && { status: query.status as any }),
        ...(query.q && {
          OR: [
            { name: { contains: query.q } },
            { email: { contains: query.q } },
          ],
        }),
      },
      orderBy: query.order === 'name' ? { name: 'asc' } : { createdAt: 'desc' },
    });
    return users.map(({ passwordHash: _, ...u }) => u);
  }
}
