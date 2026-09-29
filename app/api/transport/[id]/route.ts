import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyTransportStatus } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit";
import { transportStatusSchema } from "@/lib/validation";

const transitions: Record<string,string[]> = {
  ASSIGNED:["DRIVER_CONFIRMED","CANCELLED"],
  DRIVER_CONFIRMED:["ON_THE_WAY","CANCELLED"],
  ON_THE_WAY:["ARRIVED","CANCELLED"],
  ARRIVED:["PICKED_UP","CANCELLED"],
  PICKED_UP:["COMPLETED"],
  PENDING:["ASSIGNED","CANCELLED"],
};

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
  const {id}=await params;
  let body:unknown;
  try{body=await req.json()}catch{return NextResponse.json({error:"Invalid JSON"},{status:400})}
  const next=typeof body==="object"&&body&&"status" in body?String((body as {status?:unknown}).status||""):"";

  const ride=await prisma.transportBooking.findUnique({where:{id},include:{driver:true,booking:{include:{club:{select:{ownerId:true}},user:{select:{id:true}}}}}});
  if(!ride)return NextResponse.json({error:"Transport booking not found"},{status:404});

  const privileged=user.role==="SUPER_ADMIN"||user.role==="CLUB_OWNER";
  const ownDriver=user.role==="DRIVER"&&ride.driver?.userId===user.id;
  if(user.role==="CLUB_OWNER"&&ride.booking.club.ownerId!==user.id)return NextResponse.json({error:"Forbidden"},{status:403});
  if(!privileged&&!ownDriver)return NextResponse.json({error:"Forbidden"},{status:403});
  if(user.role==="DRIVER"&&next==="CANCELLED")return NextResponse.json({error:"Drivers cannot cancel assigned rides"},{status:403});
  if(!Object.prototype.hasOwnProperty.call(transitions,ride.status)||!transitions[ride.status].includes(next))return NextResponse.json({error:"Invalid transport status transition"},{status:400});

  const updated=await prisma.$transaction(async tx=>{
    const current=await tx.transportBooking.findUnique({where:{id},include:{booking:true}});
    if(!current)return null;
    if(!["CONFIRMED","COMPLETED"].includes(current.booking.status)||!["PAID","PARTIAL"].includes(current.booking.paymentStatus)){
      throw new Error("Booking is not active for transport");
    }
    const result=await tx.transportBooking.update({where:{id},data:{status:next as never}});
    if((next==="COMPLETED"||next==="CANCELLED")&&ride.driverId)await tx.driver.update({where:{id:ride.driverId},data:{available:true}});
    else if(ride.driverId&&next==="DRIVER_CONFIRMED")await tx.driver.update({where:{id:ride.driverId},data:{available:false}});
    return result;
  });
  if(!updated)return NextResponse.json({error:"Transport booking not found"},{status:404});
  await writeAuditLog({ userId: user.id, action: "TRANSPORT_STATUS_CHANGED", entity: "TransportBooking", entityId: updated.id, metadata: { from: ride.status, to: next, bookingId: ride.bookingId, driverId: ride.driverId } });
  notifyTransportStatus(updated.id).catch(()=>undefined);
  return NextResponse.json(updated);
}
