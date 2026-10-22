import 'reflect-metadata';
import 'dotenv/config';
import {
  Controller,
  Module,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express, { Request, Response } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { connectDatabase } from './database';
import { DomainError } from './domain';
import * as service from './service';
const uid = (req: Request) => service.authenticate(req.cookies?.survey_session);
@Catch()
class Errors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      e instanceof DomainError ? e.status : e instanceof HttpException ? e.getStatus() : 500;
    if (status === 500) console.error(e);
    res.status(status).json({
      code: e instanceof DomainError ? e.code : status === 500 ? 'INTERNAL' : 'REQUEST',
      message: status === 500 ? '服务器处理失败，请稍后重试' : e.message,
    });
  }
}
@Controller('api')
class Api {
  @Get('health') health() {
    return { ok: true, database: 'MongoDB', schemaVersion: 1 };
  }
  @Post('auth/register') register(@Body() b: any) {
    return service.register(b.username, b.password);
  }
  @Post('auth/login') async login(
    @Body() b: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await service.login(b.username, b.password, req.ip ?? 'local');
    res.cookie('survey_session', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 86400000,
      path: '/',
    });
    return result.user;
  }
  @Post('auth/logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await service.logout(req.cookies?.survey_session);
    res.clearCookie('survey_session', { path: '/' });
    return { ok: true };
  }
  @Get('auth/me') async me(@Req() r: Request) {
    return service.me(await uid(r));
  }
  @Get('surveys') async list(@Req() r: Request) {
    return service.listSurveys(await uid(r));
  }
  @Post('surveys') async create(@Req() r: Request, @Body() b: any) {
    return service.createSurvey(await uid(r), b.title);
  }
  @Get('surveys/:id') async detail(@Req() r: Request, @Param('id') id: string) {
    return service.owned(id, await uid(r));
  }
  @Put('surveys/:id/draft') async save(@Req() r: Request, @Param('id') id: string, @Body() b: any) {
    return service.saveDraft(id, await uid(r), b.definition, b.revision);
  }
  @Get('surveys/:id/routing') async routing(@Req() r: Request, @Param('id') id: string) {
    return service.readRouting(id, await uid(r));
  }
  @Get('surveys/:id/routing/upgrade-preview') async routingPreview(
    @Req() r: Request,
    @Param('id') id: string,
  ) {
    return service.previewRoutingUpgrade(id, await uid(r));
  }
  @Post('surveys/:id/routing/upgrade') async routingUpgrade(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return service.upgradeRouting(id, await uid(r), b);
  }
  @Post('surveys/:id/publish') async publish(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return service.publish(id, await uid(r), b.revision, b.deadlineAt);
  }
  @Patch('surveys/:id/deadline') async deadline(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return service.updateDeadline(id, await uid(r), b.deadlineAt);
  }
  @Post('surveys/:id/close') async close(@Req() r: Request, @Param('id') id: string) {
    return service.closeSurvey(id, await uid(r));
  }
  @Get('public/surveys/:publicId') async public(@Req() r: Request, @Param('publicId') id: string) {
    return service.publicSurvey(id, await uid(r));
  }
  @Post('public/surveys/:publicId/attempts') async begin(
    @Req() r: Request,
    @Param('publicId') id: string,
    @Body() b: any,
  ) {
    return service.beginAttempt(id, await uid(r), b.anonymous);
  }
  @Get('attempts/:id') async read(@Req() r: Request, @Param('id') id: string) {
    return service.readAttempt(id, await uid(r));
  }
  @Post('attempts/:id/advance') async advance(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return service.changeAttempt(id, await uid(r), b.revision, 'advance', b.answer);
  }
  @Post('attempts/:id/back') async back(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return service.changeAttempt(id, await uid(r), b.revision, 'back', b.questionId);
  }
  @Post('attempts/:id/submit') async submit(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return service.submit(id, await uid(r), b.revision);
  }
  @Get('surveys/:id/statistics') async stats(@Req() r: Request, @Param('id') id: string) {
    return service.statistics(id, await uid(r));
  }
  @Get('surveys/:id/questions/:qid/statistics') async questionStats(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('qid') qid: string,
  ) {
    return service.statistics(id, await uid(r), qid);
  }
  @Get('surveys/:id/questions/:qid/answers') async answers(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('qid') qid: string,
    @Query('page') page: string,
  ) {
    return service.answerPage(id, await uid(r), qid, Number(page ?? 1));
  }
}
@Module({ controllers: [Api] })
class AppModule {}
async function main() {
  await connectDatabase(
    process.env.MONGODB_URI ??
      'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true',
  );
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  // Cookie-authenticated writes must originate from the same host (including Vite's dev proxy).
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).hostname !== req.hostname)
          return res.status(403).json({ code: 'ORIGIN', message: '请求来源不合法' });
      } catch {
        return res.status(403).end();
      }
    }
    next();
  });
  app.useGlobalFilters(new Errors());
  const web = path.resolve(process.cwd(), '../web/dist');
  if (existsSync(web)) {
    app.use(express.static(web));
    app.use((req: Request, res: Response, next: () => void) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/'))
        return res.sendFile(path.join(web, 'index.html'));
      next();
    });
  }
  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
  console.log(`问序 API 已启动：http://127.0.0.1:${process.env.PORT ?? 3000}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
