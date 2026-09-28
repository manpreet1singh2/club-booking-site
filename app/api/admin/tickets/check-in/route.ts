import {NextResponse} from "next/server";
import {getCurrentUser} from "@/lib/auth";
import {prisma} from "@/lib/prisma";

export async function POST(req:Request){
  const user=await getCurrentUser();
  if(!user||!["SUPER_ADMIN","CLUB_OWNER"].includes(user.role))return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const {token}=await req.json();
    if(!token)return NextResponse.json({error:"Ticket token is required"},{status:400});
    const result=await prisma.$transaction(async tx=>{
      const booking=await tx.booking.findUnique({where:{ticketToken:String(token)},include:{club:true,checkIn:true,event:true,package:true,user:{select:{name:true}}}});
      if(!booking)return {error:"Ticket not found",status:404};
      if(user.role==="CLUB_OWNER"&&booking.club.ownerId!==user.id)return {error:"Forbidden",status:403};
      if(booking.status!=="CONFIRMED"||!["PAID","PARTIAL"].includes(booking.paymentStatus))return {error:"Ticket is not valid for entry",status:400};
      if(booking.checkIn)return {error:"Ticket has already been checked in",status:409,checkedInAt:booking.checkIn.checkedInAt};
      const checkIn=await tx.ticketCheckIn.create({data:{bookingId:booking.id,checkedInById:user.id}});
      return {ok:true,bookingCode:booking.bookingCode,guestCount:booking.guestCount,club:booking.club.name,event:booking.event?.name||booking.package.name,checkedInAt:checkIn.checkedInAt};
    },{isolationLevel:"Serializable",maxWait:5000,timeout:10000});
    if("error" in result)return NextResponse.json(result,{status:result.status});
    return NextResponse.json(result);
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Unable to check in ticket"},{status:400});}
}