import {
  renderEmailChangedNotice,
  renderEmailChangeVerificationMail,
  renderPasswordChangedNotice,
  renderPasswordResetMail,
  renderVerificationMail,
} from "../src/application/mail/templates/accountSecurityMailTemplates.ts";
import type { RenderedMailTemplate } from "../src/application/mail/templates/mailTemplate.types.ts";

const outputDirectory = "tmp/mail-previews";
const exampleUrl = "https://chat.novastrum.dev/auth?example-security-token=preview-only";

const previews: ReadonlyArray<readonly [string, RenderedMailTemplate]> = [
  [
    "verification",
    renderVerificationMail({
      toEmail: "preview@example.test",
      displayName: "Alex Preview",
      verificationUrl: exampleUrl,
    }),
  ],
  [
    "password-reset",
    renderPasswordResetMail({
      toEmail: "preview@example.test",
      displayName: "Alex Preview",
      resetUrl: exampleUrl,
    }),
  ],
  [
    "password-changed",
    renderPasswordChangedNotice({
      toEmail: "preview@example.test",
      displayName: "Alex Preview",
    }),
  ],
  [
    "email-change-verification",
    renderEmailChangeVerificationMail({
      toEmail: "preview@example.test",
      displayName: "Alex Preview",
      verificationUrl: exampleUrl,
    }),
  ],
  [
    "email-changed",
    renderEmailChangedNotice({
      toEmail: "preview@example.test",
      displayName: "Alex Preview",
      newEmail: "new-address@example.test",
    }),
  ],
];

await Deno.mkdir(outputDirectory, { recursive: true });
for (const [name, template] of previews) {
  await Deno.writeTextFile(`${outputDirectory}/${name}.html`, template.html);
  await Deno.writeTextFile(`${outputDirectory}/${name}.txt`, template.text);
}
