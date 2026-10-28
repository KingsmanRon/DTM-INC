import { BRAND } from "@/app/demo/_interactive/brand";

export interface MailtoOptions {
  email?: string;
  subject?: string;
  body?: string;
}

/**
 * Builds a `mailto:` URL for the sales enquiry. CRLF line breaks and
 * percent-encoding follow RFC 6068 so mail clients keep the template layout.
 * Never include visitor-entered or patient data here.
 */
export function buildEnquiryMailto(options: MailtoOptions = {}): string {
  const email = options.email ?? BRAND.sales.email;
  const subject = options.subject ?? BRAND.sales.subject;
  const body = (options.body ?? BRAND.sales.body).replace(/\r?\n/g, "\r\n");
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
