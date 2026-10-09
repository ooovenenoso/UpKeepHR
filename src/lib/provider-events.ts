import { db, type Tx } from "./db";
type ProviderStatus = "DELIVERED" | "BOUNCED";

export async function reconcileProviderEvents(tx: Tx, providerId: string) {
  const queued = await tx.setting.findMany({
    where: { key: { startsWith: "provider-event:" } },
  });
  for (const item of queued) {
    const event = JSON.parse(item.value) as {
      providerId: string;
      status: ProviderStatus;
    };
    if (event.providerId !== providerId) continue;
    const result = await tx.notification.updateMany({
      where: {
        providerId,
        ...(event.status === "DELIVERED" ? { status: { not: "BOUNCED" } } : {}),
      },
      data: {
        status: event.status,
        leaseUntil: null,
        error:
          event.status === "BOUNCED"
            ? "El proveedor informó rebote o queja. Verifique el correo."
            : null,
      },
    });
    if (
      result.count ||
      (await tx.notification.count({ where: { providerId } }))
    )
      await tx.setting.delete({ where: { key: item.key } });
  }
}

// Persist early webhooks too: delivery may precede the send response containing its ID.
export async function recordProviderEvent(
  eventId: string,
  providerId: string,
  status: ProviderStatus,
) {
  await db.$transaction(async (tx) => {
    if (await tx.webhookEvent.findUnique({ where: { id: eventId } })) return;
    await tx.webhookEvent.create({ data: { id: eventId } });
    await tx.setting.create({
      data: {
        key: `provider-event:${eventId}`,
        value: JSON.stringify({ providerId, status }),
      },
    });
    await reconcileProviderEvents(tx, providerId);
  });
}
