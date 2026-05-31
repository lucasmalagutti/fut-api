import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { diskStorage } from 'multer';
import * as path from 'path';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import { normalizeMediaUrl } from '../../common/utils/media-url';
import { UpdateUserDto } from '../users/dto/update-user.dto';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private auth: AuthService,
    private users: UsersService,
  ) {}

  @Public()
  @Post('auth/signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('auth/refresh')
  refresh(@CurrentUser() payload: { sub: string }) {
    return this.auth.refresh(payload);
  }

  @Public()
  @Post('auth/forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post('auth/reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('auth/logout')
  logout() {
    return { message: 'Logged out' };
  }

  @ApiBearerAuth()
  @Get('me')
  getMe(@CurrentUser() user: User) {
    const { passwordHash: _, ...safe } = user;
    return {
      ...safe,
      avatarUrl: normalizeMediaUrl(safe.avatarUrl) ?? safe.avatarUrl,
    };
  }

  @ApiBearerAuth()
  @Patch('me')
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateUserDto) {
    return this.users.update(user.id, dto);
  }

  @ApiBearerAuth()
  @Post('me/change-password')
  changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    return this.users.changePassword(user.id, dto);
  }

  @ApiBearerAuth()
  @Delete('me')
  deleteMe(@CurrentUser() user: User, @Body('password') password: string) {
    return this.users.deleteAccount(user.id, password);
  }

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: path.join(process.cwd(), 'storage', 'avatars'),
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname) || '.jpg';
          cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        // Aceita qualquer mimetype que comece com image/ — validação rígida causava rejeição
        // silenciosa quando o cliente enviava variantes como image/jpg (não-padrão mas comum)
        cb(null, file.mimetype.startsWith('image/'));
      },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    // Salva caminho relativo — o app monta a URL absoluta com a API_URL do .env
    const avatarUrl = `/storage/avatars/${file.filename}`;
    return this.users.update(user.id, { avatarUrl });
  }
}
