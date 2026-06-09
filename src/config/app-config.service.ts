import { Injectable } from '@nestjs/common';
import { getEnv, type Env } from './env.js';

@Injectable()
export class AppConfigService {
  get env(): Env {
    return getEnv();
  }
}
