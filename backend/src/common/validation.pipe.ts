import { ArgumentMetadata, Injectable, PipeTransform, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';

const LENIENT = Symbol.for('sem.lenientValidation');

/**
 * Marks a DTO whose unknown properties are stripped instead of rejected
 * (agent protocol payloads, for forward compatibility with newer agents).
 */
export function LenientValidation(): ClassDecorator {
  return (target) => {
    Object.defineProperty(target, LENIENT, { value: true });
  };
}

/** Global pipe: whitelist + forbidNonWhitelisted + transform, lenient for marked DTOs. */
@Injectable()
export class AppValidationPipe implements PipeTransform {
  private readonly strict: ValidationPipe;
  private readonly lenient: ValidationPipe;

  constructor(options: ValidationPipeOptions = {}) {
    const base: ValidationPipeOptions = {
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      ...options,
    };
    this.strict = new ValidationPipe(base);
    this.lenient = new ValidationPipe({ ...base, forbidNonWhitelisted: false });
  }

  transform(value: unknown, metadata: ArgumentMetadata) {
    const meta = metadata.metatype as unknown as Record<symbol, unknown> | undefined;
    return meta && meta[LENIENT] ? this.lenient.transform(value, metadata) : this.strict.transform(value, metadata);
  }
}
