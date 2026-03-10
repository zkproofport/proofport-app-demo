import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPPORT_EMAIL = 'support@zkproofport.app';
const FROM_EMAIL = 'ZKProofport <noreply@zkproofport.app>';

const categoryLabel: Record<string, string> = {
  general: 'General',
  beta_invite: 'Beta Invite',
  bug_report: 'Bug Report',
  feature_request: 'Feature Request',
  support: 'Support',
};

const VALID_CATEGORIES = Object.keys(categoryLabel);

export async function POST(req: NextRequest) {
  if (!RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY environment variable is required' }, { status: 500 });
  }

  let body: {
    email?: string;
    name?: string;
    subject?: string;
    body?: string;
    category?: string;
    metadata?: Record<string, string>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, name, subject, body: messageBody, category, metadata } = body;

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
    return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
  }

  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
  }

  const resolvedCategory = category || 'general';
  const trimmedEmail = email.trim();
  const trimmedSubject = subject.trim();
  const trimmedName = name?.trim() || '';

  const htmlBody = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="padding:32px 40px 24px 40px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:22px;font-weight:600;color:#111827;margin:0 0 4px 0;">
        New Inquiry — ${categoryLabel[resolvedCategory] || resolvedCategory}
      </div>
      <div style="font-size:13px;color:#6b7280;">ZKProofport</div>
    </div>
    <div style="padding:24px 40px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">From</div>
      <div style="font-size:15px;color:#111827;">
        ${trimmedName ? `${trimmedName} &lt;${trimmedEmail}&gt;` : trimmedEmail}
      </div>
    </div>
    <div style="padding:20px 40px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">Subject</div>
      <div style="font-size:17px;font-weight:600;color:#111827;">${trimmedSubject}</div>
    </div>
    ${messageBody ? `
    <div style="padding:32px 40px;background:#f9fafb;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:15px;line-height:1.6;color:#111827;white-space:pre-wrap;">${messageBody}</div>
    </div>
    ` : ''}
    ${metadata && Object.keys(metadata).length > 0 ? `
    <div style="padding:20px 40px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">Additional Information</div>
      <div style="font-size:13px;color:#374151;">
        ${Object.entries(metadata).map(([k, v]) => `<div style="margin-bottom:4px;"><span style="color:#6b7280;">${k}:</span> ${v}</div>`).join('')}
      </div>
    </div>
    ` : ''}
    <div style="padding:24px 40px;background:#f9fafb;">
      <div style="font-size:12px;color:#9ca3af;">
        ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
      </div>
    </div>
  </div>
`;

  const resend = new Resend(RESEND_API_KEY);

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: SUPPORT_EMAIL,
      replyTo: trimmedEmail,
      subject: `[${categoryLabel[resolvedCategory] || resolvedCategory}] ${trimmedSubject}`,
      html: htmlBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
