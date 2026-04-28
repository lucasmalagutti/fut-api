import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private userSockets = new Map<string, string>();

  constructor(private chat: ChatService) {}

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.userSockets.set(userId, client.id);
      client.data.userId = userId;
    }
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.userSockets.delete(client.data.userId);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string; body: string },
  ) {
    const senderId = client.data.userId;
    if (!senderId) return;

    const message = await this.chat.sendMessage(data.threadId, senderId, data.body);
    this.server.to(data.threadId).emit('message:new', message);
    return message;
  }

  @SubscribeMessage('thread:join')
  handleJoinThread(@ConnectedSocket() client: Socket, @MessageBody() threadId: string) {
    client.join(threadId);
  }

  @SubscribeMessage('message:read')
  async handleRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() threadId: string,
  ) {
    const userId = client.data.userId;
    if (!userId) return;
    await this.chat.markRead(threadId, userId);
    this.server.to(threadId).emit('message:read', { threadId, userId });
  }
}
