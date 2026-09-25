import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthContextService } from './auth-context.service';
import { LdapService } from './ldap.service';
import { SsoService } from './sso/sso.service';
import { JwtStrategy } from './guards/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtAccessSecret,
        signOptions: { algorithm: 'HS256', issuer: 'secureendpoint-manager' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'secureendpoint-manager' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthContextService, LdapService, SsoService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, AuthContextService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
