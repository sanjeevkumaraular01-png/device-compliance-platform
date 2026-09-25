import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as forge from 'node-forge';
import { createHash, randomBytes } from 'crypto';
import { AppConfigService } from '../config/app-config.service';

export interface IssuedCertificate {
  pem: string;
  serialNumber: string;
  fingerprint: string;
  subject: string;
  issuedAt: Date;
  expiresAt: Date;
}

const CA_VALIDITY_YEARS = 10;
const DEVICE_CERT_VALIDITY_DAYS = 365;

/**
 * Internal device CA. The key pair is generated on first boot if CA_CERT_PATH /
 * CA_KEY_PATH do not exist. Signs agent CSRs (RSA; node-forge cannot parse ECDSA CSRs).
 */
@Injectable()
export class CaService implements OnModuleInit {
  private readonly logger = new Logger(CaService.name);
  private caCert!: forge.pki.Certificate;
  private caKey!: forge.pki.rsa.PrivateKey;
  private caPem!: string;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    this.loadOrCreate();
  }

  get caCertificatePem(): string {
    return this.caPem;
  }

  private loadOrCreate(): void {
    const certPath = path.resolve(this.config.caCertPath);
    const keyPath = path.resolve(this.config.caKeyPath);
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      this.generate(certPath, keyPath);
    }
    this.caPem = fs.readFileSync(certPath, 'utf8');
    this.caCert = forge.pki.certificateFromPem(this.caPem);
    this.caKey = forge.pki.privateKeyFromPem(fs.readFileSync(keyPath, 'utf8')) as forge.pki.rsa.PrivateKey;
    this.logger.log(`Device CA loaded: ${this.caCert.subject.getField('CN')?.value} (expires ${this.caCert.validity.notAfter.toISOString()})`);
  }

  private generate(certPath: string, keyPath: string): void {
    this.logger.warn('Device CA not found - generating a new RSA-3072 CA key pair');
    const keys = forge.pki.rsa.generateKeyPair({ bits: 3072, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01' + randomBytes(15).toString('hex');
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CA_VALIDITY_YEARS);
    const attrs = [
      { name: 'commonName', value: 'SecureEndpoint Manager Device CA' },
      { name: 'organizationName', value: 'SecureEndpoint Manager' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    try {
      // 'wx' avoids clobbering a CA written concurrently by another process.
      fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey), { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(certPath, forge.pki.certificateToPem(cert), { flag: 'wx', mode: 0o644 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      this.logger.warn('CA files were created concurrently by another process; using them');
    }
  }

  /** Verify and sign an agent CSR (PEM). The subject CN is forced to the device id. */
  signCsr(csrPem: string, deviceId: string): IssuedCertificate {
    let csr: forge.pki.CertificateSigningRequest;
    try {
      csr = forge.pki.certificationRequestFromPem(csrPem);
    } catch {
      throw new BadRequestException('csrPem is not a valid RSA certificate signing request');
    }
    if (!csr.verify()) throw new BadRequestException('CSR signature verification failed');
    const pub = csr.publicKey as forge.pki.rsa.PublicKey;
    if (!pub || !pub.n || pub.n.bitLength() < 2048) throw new BadRequestException('CSR key must be RSA >= 2048 bits');

    const cert = forge.pki.createCertificate();
    cert.publicKey = pub;
    cert.serialNumber = '01' + randomBytes(15).toString('hex');
    const issuedAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(issuedAt.getTime() + DEVICE_CERT_VALIDITY_DAYS * 86_400_000);
    cert.validity.notBefore = issuedAt;
    cert.validity.notAfter = expiresAt;
    const subject = [
      { name: 'commonName', value: deviceId },
      { name: 'organizationName', value: 'SecureEndpoint Manager' },
      { name: 'organizationalUnitName', value: 'Managed Devices' },
    ];
    cert.setSubject(subject);
    cert.setIssuer(this.caCert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', clientAuth: true },
      { name: 'subjectKeyIdentifier' },
      { name: 'subjectAltName', altNames: [{ type: 6, value: `urn:sem:device:${deviceId}` }] },
    ]);
    cert.sign(this.caKey, forge.md.sha256.create());
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    return {
      pem: forge.pki.certificateToPem(cert),
      serialNumber: cert.serialNumber,
      fingerprint: createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex'),
      subject: `CN=${deviceId},OU=Managed Devices,O=SecureEndpoint Manager`,
      issuedAt,
      expiresAt,
    };
  }
}
