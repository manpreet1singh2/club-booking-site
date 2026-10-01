import {NextResponse} from "next/server";
import {getCurrentUser,isSameOrigin} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {writeAuditLog} from "@/lib/audit";

function sameLocalDate(a:Date,b:Date){
  return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
}

export async function POST(req:Request){
  if(!isSameOrigin(req))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const user=await getCurrentUser();
  if(!user||!["SUPER_ADMIN","CLUB_OWNER"].includes(user.role))return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const {token}=await req.json();
    if(typeof token!=="string"||!token||token.length>200||!/^[A-Za-z0-9_-]+$/.test(token))return NextResponse.json({error:"Invalid ticket token"},{status:400});
    const result=await prisma.$transaction(async tx=>{
      const booking=await tx.booking.findUnique({
        where:{ticketToken:token},
        select:{
          id:true,
          bookingCode:true,
          guestCount:true,
          status:true,
          paymentStatus:true,
          visitDate:true,
          club:{select:{id:true,name:true,ownerId:true}},
          checkIn:{select:{checkedInAt:true}},
          event:{select:{name:true}},
          package:{select:{name:true}},
        },
      });
      if(!booking)return {error:"Ticket not found",status:404};
      if(user.role==="CLUB_OWNER"&&booking.club.ownerId!==user.id)return {error:"Forbidden",status:403};
      if(booking.status!=="CONFIRMED"||!["PAID","PARTIAL"].includes(booking.paymentStatus))return {error:"Ticket is not valid for entry",status:400};
      if(!sameLocalDate(new Date(booking.visitDate),new Date()))return {error:"This ticket can only be checked in on the booking date",status:400};
      if(booking.checkIn)return {error:"Ticket has already been checked in",status:409,checkedInAt:booking.checkIn.checkedInAt};
      const checkIn=await tx.ticketCheckIn.create({data:{bookingId:booking.id,checkedInById:user.id}});
      return {ok:true,bookingCode:booking.bookingCode,guestCount:booking.guestCount,club:booking.club.name,event:booking.event?.name||booking.package.name,checkedInAt:checkIn.checkedInAt};
    },{isolationLevel:"Serializable",maxWait:5000,timeout:10000});
    if("error" in result)return NextResponse.json(result,{status:result.status,headers:{"Cache-Control":"private, no-store, max-age=0"}});
    await writeAuditLog({userId:user.id,action:"TICKET_CHECKED_IN",entity:"Booking",entityId:result.bookingCode,metadata:{guestCount:result.guestCount}});
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store, max-age=0"}});
  }catch(e){
    if(e instanceof Error && (e.message.includes("Unique constraint") || e.message.includes("P2002"))) return NextResponse.json({error:"Ticket was checked in by another scanner. Refresh to view the check-in."},{status:409});
    return NextResponse.json({error:e instanceof Error?e.message:"Unable to check in ticket"},{status:400});
  }
}
