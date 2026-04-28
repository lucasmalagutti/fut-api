import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async getOrCreateThread(userAId: string, userBId: string) {
    const [a, b] = [userAId, userBId].sort();
    return this.prisma.chatThread.upsert({
      where: { userAId_userBId: { userAId: a, userBId: b } },
      update: {},
      create: { userAId: a, userBId: b },
    });
  }

  async listThreads(userId: string) {
    return this.prisma.chatThread.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        userA: { select: { id: true, name: true, avatarUrl: true } },
        userB: { select: { id: true, name: true, avatarUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async getMessages(threadId: string, userId: string) {
    const thread = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread || (thread.userAId !== userId && thread.userBId !== userId)) {
      throw new NotFoundException('Thread not found');
    }
    return this.prisma.chatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async sendMessage(threadId: string, senderId: string, body: string) {
    const thread = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread || (thread.userAId !== senderId && thread.userBId !== senderId)) {
      throw new NotFoundException('Thread not found');
    }

    const message = await this.prisma.chatMessage.create({
      data: { threadId, senderId, body },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });

    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: message.createdAt },
    });

    return message;
  }

  async markRead(threadId: string, userId: string) {
    await this.prisma.chatMessage.updateMany({
      where: { threadId, readAt: null, sender: { id: { not: userId } } },
      data: { readAt: new Date() },
    });
  }
}
