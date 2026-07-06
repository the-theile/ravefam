// Shared rendering helpers for every RaveFAM transactional/lifecycle email
// (used by both send-drip-emails and send-lifecycle-emails). Screenshots are
// captured via scripts/capture-email-screenshots.js and committed as static
// assets under screenshots/email/.

export function wrapEmail(appOrigin: string, preheader: string, bodyHtml: string, unsubToken: string): string {
  const unsubUrl = `${appOrigin}/unsubscribe.html?u=${unsubToken}`;
  return `<!doctype html>
<html><body style="margin:0;background:#0a0a0f;font-family:Outfit,Arial,sans-serif;color:#e8e8f0;">
<span style="display:none;">${preheader}</span>
<div style="max-width:520px;margin:0 auto;padding:32px 24px;">
  <div style="font-family:Syne,Arial,sans-serif;font-weight:800;font-size:1.2rem;margin-bottom:24px;">
    <span style="color:#fff;">Rave</span><span style="color:#39FF14;">FAM</span>
  </div>
  ${bodyHtml}
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #1e1e2e;font-size:0.75rem;color:#6b6b8a;">
    You're getting this because you signed up for RaveFAM.
    <a href="${unsubUrl}" style="color:#6b6b8a;">Unsubscribe</a>
  </div>
</div>
</body></html>`;
}

export function button(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#FF2D78;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">${label}</a>`;
}

// Framed in a surface/border card so the dark UI screenshot doesn't bleed
// into the email's own dark background with no visible edge.
export function screenshot(appOrigin: string, file: string, alt: string): string {
  return `<div style="margin:12px 0 24px;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden;background:#12121a;">
        <img src="${appOrigin}/screenshots/email/${file}" alt="${alt}" width="480" style="display:block;width:100%;max-width:480px;height:auto;" />
      </div>`;
}

// A labeled feature callout followed by its screenshot -- the repeating unit
// for "one screenshot per feature mentioned" emails, so a stack of these
// reads as a visual tour rather than a bare list of unlabeled images.
export function feature(appOrigin: string, emoji: string, title: string, desc: string, file: string, alt: string): string {
  return `<p style="margin-bottom:6px;"><strong>${emoji} ${title}</strong> — ${desc}</p>
      ${screenshot(appOrigin, file, alt)}`;
}
