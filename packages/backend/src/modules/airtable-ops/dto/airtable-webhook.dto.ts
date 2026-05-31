/**
 * Shape of the Airtable webhook notification payload.
 * https://airtable.com/developers/web/api/webhooks-overview
 */
export class AirtableWebhookPayloadDto {
  timestamp!: string;
  baseId!: string;
  webhookId!: string;
  cursor!: number;
}
