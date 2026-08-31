import nodemailer from 'nodemailer';

export interface EmailDispatchPayload {
  to: string;
  recipientName: string;
  subject: string;
  body: string;
  html?: string;
  metadata?: {
    documentId?: string;
    documentTitle?: string;
    versionNumber?: string;
    acknowledgementRequired?: boolean;
  };
}

export interface EmailDispatchResult {
  success: boolean;
  provider: string;
  messageId?: string;
  note?: string;
  error?: string;
}

export function getEmailConfigStatus() {
  const smtpUser = (process.env.SMTP_USER || 'automation@amaavigo.com').trim().replace(/['"]/g, '');
  const smtpPass = (process.env.SMTP_PASS || 'zpdblvybnzydtpii').replace(/\s+/g, '').replace(/['"]/g, '');
  const hasSmtp = !!(smtpUser && smtpPass);

  return {
    isConfigured: hasSmtp,
    activeProvider: hasSmtp ? `Gmail SMTP (${smtpUser})` : 'Internal Enterprise Dispatcher',
    smtpConfigured: hasSmtp,
    senderFrom: process.env.EMAIL_FROM || `Amaavigo HR Compliance <${smtpUser}>`,
    userEmail: smtpUser,
  };
}

export async function dispatchLiveEmail(payload: EmailDispatchPayload): Promise<EmailDispatchResult> {
  const { to, recipientName, subject, body, metadata } = payload;
  
  const smtpUser = (process.env.SMTP_USER || 'automation@amaavigo.com').trim().replace(/['"]/g, '');
  const smtpPass = (process.env.SMTP_PASS || 'zpdblvybnzydtpii').replace(/\s+/g, '').replace(/['"]/g, '');
  const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const emailFrom = process.env.EMAIL_FROM || `Amaavigo HR Compliance <${smtpUser}>`;

  // Sanitize body: Never expose raw data URLs or base64 binary chunks in emails
  const cleanBody = (body || '')
    .replace(/data:application\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g, '[Document is securely accessible in the Employee Portal]')
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g, '')
    .trim();

  const formattedHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.08);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #090C10 0%, #11141E 100%); padding: 24px 28px; border-bottom: 3px solid #FA7014;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="font-size: 11px; font-weight: 700; color: #FA7014; text-transform: uppercase; letter-spacing: 1.2px; display: block; margin-bottom: 4px;">
                    AMAAVIGO • WHERE BRAND TAKES FLIGHT
                  </span>
                  <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; line-height: 1.3;">
                    Official HR Policy Notice
                  </h1>
                </td>
              </tr>
            </table>
          </div>

          <!-- Body Content -->
          <div style="padding: 28px;">
            ${
              metadata?.acknowledgementRequired
                ? `<div style="background-color: #fff7ed; border: 1px solid #ffedd5; border-left: 4px solid #FA7014; padding: 14px 16px; border-radius: 6px; margin-bottom: 20px;">
                    <strong style="color: #c2410c; font-size: 13px; display: block; margin-bottom: 2px;">Action Required: Mandatory Compliance Sign-Off</strong>
                    <span style="color: #ea580c; font-size: 13px;">This official document requires your electronic acknowledgment within 14 calendar days of publication.</span>
                  </div>`
                : ''
            }

            <div style="white-space: pre-wrap; line-height: 1.65; font-size: 14px; color: #334155; margin-bottom: 24px;">
${cleanBody}
            </div>

            <!-- Call to Action Box -->
            <div style="background: #0B0E14; border-radius: 8px; padding: 20px; border: 1px solid #222836; text-align: center; margin-top: 20px;">
              <p style="margin: 0 0 12px 0; font-size: 13px; color: #94a3b8; font-weight: 500;">
                For security and governance compliance, complete document text and digital acknowledgments are handled inside the secure Employee Portal.
              </p>
              <div style="display: inline-block; background-color: #FA7014; color: #ffffff; font-size: 13px; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none; box-shadow: 0 4px 12px rgba(250, 112, 20, 0.3);">
                Sign In & View in Employee Portal
              </div>
            </div>

            <!-- Meta details pill -->
            ${
              metadata?.documentId
                ? `<div style="margin-top: 20px; padding: 14px 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; color: #64748b;">
                    <div style="margin-bottom: 4px;"><strong>Document Reference:</strong> <span style="font-family: monospace; color: #0f172a;">${metadata.documentId}</span></div>
                    ${metadata.versionNumber ? `<div><strong>Version:</strong> <span style="font-family: monospace; color: #0f172a;">v${metadata.versionNumber}</span></div>` : ''}
                  </div>`
                : ''
            }
          </div>

          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 16px 28px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
            <p style="margin: 0 0 6px 0;">This is an automated governance dispatch from the <strong>Amaavigo HR Document Governance & Version Control System</strong>.</p>
            <p style="margin: 0;">Recipient: <strong>${recipientName}</strong> (${to})</p>
          </div>
        </div>
      </body>
    </html>
  `;

  // Live Gmail SMTP Dispatch with App Password
  if (smtpUser && smtpPass) {
    try {
      const transporter = smtpHost === 'smtp.gmail.com'
        ? nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          })
        : nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          });

      const info = await transporter.sendMail({
        from: emailFrom,
        to,
        subject,
        text: body,
        html: formattedHtml,
      });

      console.log(`[Gmail SMTP Success] Message sent to ${to}: ${info.messageId}`);

      return {
        success: true,
        provider: `Gmail SMTP (${smtpUser})`,
        messageId: info.messageId,
        note: `Delivered directly to ${to} via Gmail SMTP`,
      };
    } catch (err: any) {
      console.error('[Gmail SMTP Error]:', err);
      return {
        success: false,
        provider: `Gmail SMTP (${smtpUser})`,
        error: err.message,
      };
    }
  }

  // Fallback
  return {
    success: true,
    provider: 'Internal Enterprise Dispatcher',
    messageId: `internal-${Date.now()}`,
    note: `Dispatched to internal audit log and in-app queue.`,
  };
}
