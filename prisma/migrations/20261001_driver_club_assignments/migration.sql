CREATE TABLE "DriverClub" (
  "driverId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverClub_pkey" PRIMARY KEY ("driverId", "clubId")
);

CREATE INDEX "DriverClub_clubId_idx" ON "DriverClub"("clubId");

ALTER TABLE "DriverClub"
ADD CONSTRAINT "DriverClub_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverClub"
ADD CONSTRAINT "DriverClub_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DriverClub" ("driverId", "clubId")
SELECT DISTINCT tb."driverId", b."clubId"
FROM "TransportBooking" tb
INNER JOIN "Booking" b ON b."id" = tb."bookingId"
WHERE tb."driverId" IS NOT NULL;
