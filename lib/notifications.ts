import { prisma } from "@/lib/prisma";

type TemplateMessage = { to: string; template: string; parameters?: string[]; userId?: string | null };

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}

async function sendWhatsApp(message: TemplateMessage) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
  if (!token || !phoneNumberId) {
    await prisma.notificationLog.create({ data: { userId: message.userId || null, channel: "WHATSAPP", template: message.template, status: "SKIPPED_NOT_CONFIGURED" } });
    return { sent: false, reason: "not_configured" };
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(message.to),
      type: "template",
      template: { name: message.template, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" }, components: message.parameters?.length ? [{ type: "body", parameters: message.parameters.map(text => ({ type: "text", text })) }] : undefined },
    }),
  });

  const data = await response.json().catch(() => ({}));
  await prisma.notificationLog.create({
    data: {
      userId: message.userId || null,
      channel: "WHATSAPP",
      template: message.template,
      status: response.ok ? "SENT" : "FAILED",
      providerMessageId: data?.messages?.[0]?.id || null,
    },
  });
  return { sent: response.ok, data };
}

export async function notifyBookingCreated(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { user: true, club: { include: { owner: true } }, package: true } });
  if (!booking) return;
  if (booking.user.phone) await sendWhatsApp({ to: booking.user.phone, userId: booking.user.id, template: process.env.WA_TEMPLATE_BOOKING_CREATED || "booking_created", parameters: [booking.user.name, booking.bookingCode, booking.club.name, booking.package.name] });
}

export async function notifyBookingConfirmed(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { user: true, club: { include: { owner: true } }, package: true } });
  if (!booking) return;
  if (booking.user.phone) await sendWhatsApp({ to: booking.user.phone, userId: booking.user.id, template: process.env.WA_TEMPLATE_BOOKING_CONFIRMED || "booking_confirmed", parameters: [booking.user.name, booking.bookingCode, booking.club.name, booking.package.name] });
  if (booking.club.owner?.phone) await sendWhatsApp({ to: booking.club.owner.phone, userId: booking.club.owner.id, template: process.env.WA_TEMPLATE_OWNER_BOOKING || "club_new_booking", parameters: [booking.bookingCode, booking.user.name, booking.club.name] });
}

export async function notifyTransportAssigned(transportId: string) {
  const ride = await prisma.transportBooking.findUnique({ where: { id: transportId }, include: { booking: { include: { user: true, club: true } }, driver: { include: { user: true } } } });
  if (!ride) return;
  if (ride.booking.user.phone) await sendWhatsApp({ to: ride.booking.user.phone, userId: ride.booking.user.id, template: process.env.WA_TEMPLATE_TRANSPORT_ASSIGNED || "transport_assigned", parameters: [ride.booking.bookingCode, ride.type, ride.pickupLocation, ride.pickupTime.toLocaleString("en-IN"), ride.driver?.user.name || "Pending"] });
  if (ride.driver?.user.phone) await sendWhatsApp({ to: ride.driver.user.phone, userId: ride.driver.user.id, template: process.env.WA_TEMPLATE_DRIVER_RIDE || "driver_ride_assigned", parameters: [ride.booking.bookingCode, ride.booking.user.name, ride.pickupLocation, ride.pickupTime.toLocaleString("en-IN")] });
}

export async function notifyTransportStatus(transportId: string) {
  const ride = await prisma.transportBooking.findUnique({ where: { id: transportId }, include: { booking: { include: { user: true } } } });
  if (!ride || !ride.booking.user.phone) return;
  await sendWhatsApp({ to: ride.booking.user.phone, userId: ride.booking.user.id, template: process.env.WA_TEMPLATE_TRANSPORT_STATUS || "transport_status", parameters: [ride.booking.bookingCode, ride.status.replaceAll("_", " ")] });
}
