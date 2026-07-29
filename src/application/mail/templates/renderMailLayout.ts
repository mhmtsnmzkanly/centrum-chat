import { escapeMailHtml, requireSafeMailUrl } from "./escapeMailHtml.ts";
import type { MailLayoutInput, RenderedMailTemplate } from "./mailTemplate.types.ts";

const brandColor = "#0284c7";
const publicSite = "chat.novastrum.dev";

function textParagraphs(paragraphs: readonly string[]): string {
  return paragraphs.map((paragraph) => `${paragraph}\n`).join("\n");
}

export function renderMailLayout(
  input: MailLayoutInput & { readonly subject: string },
): RenderedMailTemplate {
  const actionUrl = input.action ? requireSafeMailUrl(input.action.url) : undefined;
  const actionLabel = input.action ? escapeMailHtml(input.action.label) : undefined;
  const fallback = actionUrl
    ? `<tr><td style="padding:0 32px 8px;color:#5f6b76;font-family:Arial,sans-serif;font-size:14px;line-height:21px;word-break:break-word">If the button does not work, copy and paste this address into your browser:<br><a href="${
      escapeMailHtml(actionUrl)
    }" style="color:${brandColor};text-decoration:underline">${
      escapeMailHtml(actionUrl)
    }</a></td></tr>`
    : "";
  const button = actionUrl && actionLabel
    ? `<tr><td style="padding:8px 32px 20px"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${brandColor}" style="border-radius:8px"><a href="${
      escapeMailHtml(actionUrl)
    }" style="display:inline-block;padding:13px 20px;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:20px;text-decoration:none">${actionLabel}</a></td></tr></table></td></tr>`
    : "";
  const htmlParagraphs = input.paragraphs.map((paragraph) =>
    `<p style="margin:0 0 16px;color:#17202a;font-family:Arial,sans-serif;font-size:16px;line-height:24px">${
      escapeMailHtml(paragraph)
    }</p>`
  ).join("");
  const escapedPreheader = escapeMailHtml(input.preheader);
  const escapedTitle = escapeMailHtml(input.title);
  const escapedGreeting = escapeMailHtml(input.greeting);
  const escapedNotice = escapeMailHtml(input.securityNotice);

  return {
    subject: input.subject,
    html:
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f3f6f8"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapedPreheader}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f6f8"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px"><tr><td style="padding:0 12px 14px;color:${brandColor};font-family:Arial,sans-serif;font-size:24px;font-weight:700;letter-spacing:-0.4px">CentrumChat</td></tr><tr><td style="background:#ffffff;border:1px solid #dfe5e9;border-radius:14px;overflow:hidden"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:32px 32px 8px;color:#17202a;font-family:Arial,sans-serif;font-size:24px;font-weight:700;line-height:30px">${escapedTitle}</td></tr><tr><td style="padding:8px 32px 4px;color:#17202a;font-family:Arial,sans-serif;font-size:16px;line-height:24px">${escapedGreeting}</td></tr><tr><td style="padding:12px 32px 0">${htmlParagraphs}</td></tr>${button}${fallback}<tr><td style="padding:16px 32px 28px;color:#5f6b76;font-family:Arial,sans-serif;font-size:14px;line-height:21px">${escapedNotice}</td></tr></table></td></tr><tr><td align="center" style="padding:20px 12px 0;color:#5f6b76;font-family:Arial,sans-serif;font-size:12px;line-height:18px">CentrumChat<br><a href="https://${publicSite}" style="color:#5f6b76;text-decoration:underline">${publicSite}</a><br>This is an automated account security email.</td></tr></table></td></tr></table></body></html>`,
    text: `${input.greeting}\n\n${textParagraphs(input.paragraphs)}${
      actionUrl ? `${input.action!.label}: ${actionUrl}\n\n` : ""
    }${input.securityNotice}\n\nCentrumChat\n${publicSite}\nThis is an automated account security email.\n`,
  };
}
