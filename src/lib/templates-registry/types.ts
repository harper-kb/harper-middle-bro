export type TemplateChannel = "email" | "text";

export type ServiceTemplate = {
  id: string;
  name: string;
  channel: TemplateChannel;
  /** Notion page id or URL when synced */
  notionSourceId: string | null;
  notionSourceUrl: string | null;
  version: number;
  requestType: string | null;
  subject: string | null;
  body: string;
  placeholders: string[];
  updatedAt: string;
  provenance: string;
};
