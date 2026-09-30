import {NextRequest,NextResponse} from "next/server";
import {getCurrentUser} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {notifyTransportAssigned} from "@/lib/notifications";
import {transportCreateSchema} from "@/lib/validation";

export async function GET(req:NextRequest){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
  const driverId=new URL(req.url).searchParams.get("driverId");
  const transport=await prisma.transportBooking.findMany({
    where:user.role==="SUPER_ADMIN"?driverId?{driverId}:{}
      :user.role==="CLUB_OWNER"?{...(driverId?{driverId}:{}),booking:{club:{ownerId:user.id}}}
      :user.role==="DRIVER"?{driver:{userId:user.id}}:{booking:{userId:user.id}},
    include:{booking:{include:{club:true,user:{select:{id:true,name:true,phone:true}}}},driver:{include:{user:{select:{id:true,name:true,phone:true}}}}},
    orderBy:{pickupTime:"asc"}
  });
  return NextResponse.json(transport);
}

export async function POST(req:NextRequest){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
  if(user.role!=="SUPER_ADMIN"&&user.role!=="CLUB_OWNER")return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const body=transportCreateSchema.parse(await req.json());
    const bookingId=body.bookingId;
    const requestedDriverId=body.driverId || null;

    const transport=await prisma.$transaction(async tx=>{
      const booking=await tx.booking.findUnique({where:{id:bookingId},include:{club:{select:{ownerId:true}}}});
      if(!booking)return {error:"Booking not found",status:404};
      if(user.role==="CLUB_OWNER"&&booking.club.ownerId!==user.id)return {error:"Forbidden",status:403};
      if(!["CONFIRMED"].includes(booking.status)||!["PAID","PARTIAL"].includes(booking.paymentStatus))return {error:"Booking must be confirmed and paid before transport assignment",status:400};
      if(booking.transportType==="NONE"||!booking.pickupLocation||!booking.pickupTime)return {error:"Booking has no valid transport request",status:400};

      const existing=await tx.transportBooking.findUnique({where:{bookingId},include:{driver:true}});
      if(existing&&["COMPLETED","CANCELLED"].includes(existing.status))return {error:"Transport ride is already closed",status:400};

      let selectedDriverId=requestedDriverId;
      if(!selectedDriverId&&!existing?.driverId){
        const available=await tx.driver.findFirst({where:{available:true,vehicleType:booking.transportType},orderBy:{id:"asc"}});
        selectedDriverId=available?.id||null;
      }

      if(selectedDriverId){
        const driver=await tx.driver.findUnique({where:{id:selectedDriverId}});
        if(!driver||driver.vehicleType!==booking.transportType)return {error:"Selected driver is invalid for this transport type",status:400};
        if(existing?.driverId!==selectedDriverId&&!driver.available)return {error:"Selected driver is unavailable",status:409};

        const pickupWindowStart=new Date(booking.pickupTime.getTime()-2*60*60*1000);
        const pickupWindowEnd=new Date(booking.pickupTime.getTime()+2*60*60*1000);
        const conflictingRide=await tx.transportBooking.findFirst({
          where:{
            driverId:selectedDriverId,
            id:existing?.id?{not:existing.id}:undefined,
            status:{in:["PENDING","ASSIGNED","DRIVER_CONFIRMED","ON_THE_WAY","ARRIVED","PICKED_UP"]},
            pickupTime:{gte:pickupWindowStart,lte:pickupWindowEnd},
          },
          select:{id:true,pickupTime:true,booking:{select:{bookingCode:true}}},
        });
        if(conflictingRide)return {error:"Driver already has an overlapping ride around this pickup time",status:409};

        if(existing?.driverId!==selectedDriverId){
          const claimed=await tx.driver.updateMany({where:{id:selectedDriverId,available:true},data:{available:false}});
          if(claimed.count!==1)return {error:"Selected driver was just assigned to another ride",status:409};

          if(existing?.driverId)await tx.driver.update({where:{id:existing.driverId},data:{available:true}});
        }
      }else if(existing?.driverId){
        await tx.driver.update({where:{id:existing.driverId},data:{available:true}});
      }

      const saved=await tx.transportBooking.upsert({
        where:{bookingId},
        create:{bookingId,driverId:selectedDriverId,type:booking.transportType,pickupLocation:booking.pickupLocation,pickupTime:booking.pickupTime,status:selectedDriverId?"ASSIGNED":"PENDING"},
        update:{driverId:selectedDriverId,status:selectedDriverId?"ASSIGNED":"PENDING",pickupLocation:booking.pickupLocation,pickupTime:booking.pickupTime},
        include:{driver:{include:{user:{select:{id:true,name:true,phone:true}}}}}
      });
      return {saved};
    },{isolationLevel:"Serializable",maxWait:5000,timeout:10000});

    if("error" in transport)return NextResponse.json({error:transport.error},{status:transport.status});
    notifyTransportAssigned(transport.saved.id).catch(()=>undefined);
    return NextResponse.json(transport.saved,{status:201});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to assign transport"},{status:400});
  }
}