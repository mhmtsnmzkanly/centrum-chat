export interface RenderedMailTemplate {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface MailAction {
  readonly label: string;
  readonly url: string;
}

export interface MailLayoutInput {
  readonly preheader: string;
  readonly title: string;
  readonly greeting: string;
  readonly paragraphs: readonly string[];
  readonly action?: MailAction;
  readonly securityNotice: string;
}
