import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import type { WebhookEvent, GitProviderAdapter } from "./types";

const log = createLogger("git:webhook");

export interface WebhookHandlerOpts {
  headers: Record<string, string>;
  rawBody: string;
  parsedBody: unknown;
  webhookSecret: string;
  adapter: GitProviderAdapter;
  checkDeliveryId: (id: string) => Promise<boolean>; // returns true if already seen
  recordDeliveryId: (id: string) => Promise<void>;
}

export async function handleWebhook(
  opts: WebhookHandlerOpts,
): Promise<Result<WebhookEvent, Error>> {
  const {
    headers,
    rawBody,
    parsedBody,
    webhookSecret,
    adapter,
    checkDeliveryId,
    recordDeliveryId,
  } = opts;

  // Validate signature
  const isValid = adapter.validateWebhookSignature(
    headers,
    rawBody,
    webhookSecret,
  );
  if (!isValid) {
    log.warn("webhook signature validation failed");
    return Result.err(new Error("Invalid webhook signature"));
  }

  // Parse the event
  const eventResult = adapter.parseWebhook(headers, parsedBody);
  if (eventResult.isErr()) {
    log.warn(
      { error: eventResult.error.message },
      "failed to parse webhook event",
    );
    return eventResult;
  }

  const event = eventResult.value;

  // Check replay protection
  const alreadySeen = await checkDeliveryId(event.deliveryId);
  if (alreadySeen) {
    log.warn(
      { deliveryId: event.deliveryId },
      "duplicate webhook delivery detected",
    );
    return Result.err(
      new Error(`Duplicate webhook delivery: ${event.deliveryId}`),
    );
  }

  // Record the delivery ID
  await recordDeliveryId(event.deliveryId);

  log.info(
    {
      type: event.type,
      repo: event.repository.fullName,
      branch: event.branch,
      deliveryId: event.deliveryId,
    },
    "webhook event processed",
  );

  return Result.ok(event);
}
