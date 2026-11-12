// AI-generated code
import nodemailer from 'nodemailer';

export interface MailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Builds a per-installation SMTP sender without embedding credentials in code. */
export function smtpSender(settings: SmtpSettings): MailSender {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.password ?? '' } : undefined,
  });
  return {
    /** Sends a plain-text transactional message through the configured relay. */
    async send(to: string, subject: string, body: string): Promise<void> {
      await transport.sendMail({ from: settings.from, to, subject, text: body });
    },
  };
}
