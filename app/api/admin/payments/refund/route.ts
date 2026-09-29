import {NextResponse} from "next/server";
import {getCurrentUser} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {createRazorpayRefund} from "@/lib/razorpay";

export async function POST(req:Request){
  const u=await getCurrentUser();
  if(!u||u.role!=="SUPER_ADMIN")return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const {bookingId}=await req.json();
    if(!bookingId)return NextResponse.json({error:"bookingId is required"},{status:400});
    const booking=await prisma.booking.findUnique({where:{id:String(bookingId)},include:{payments:true}});
    if(!booking)return NextResponse.json({error:"Booking not found"},{status:404});
    if(booking.status!=="REFUND_PENDING")return NextResponse.json({error:"Booking must be refund-pending"},{status:400});

    const captured=booking.payments.filter(p=>p.status==="PAID"&&p.gatewayPaymentId);
    if(!captured.length)return NextResponse.json({error:"No captured payment is available for refund"},{status:400});

    const results=[];
    for(const payment of captured){
      if(payment.refundId || payment.status==="REFUNDED") continue;
      const amount=Number(payment.amount);
      if(amount<=0) continue;
      const refund=await createRazorpayRefund(payment.gatewayPaymentId!,amount,booking.bookingCode);
      await prisma.payment.update({where:{id:payment.id},data:{refundId:refund.id,refundedAmount:amount,status:"REFUNDED"}});
      results.push({paymentId:payment.id,refundId:refund.id,amount});
    }

    const remaining=await prisma.payment.count({where:{bookingId:booking.id,status:"PAID",gatewayPaymentId:{not:null}}});
    if(remaining===0) await prisma.booking.update({where:{id:booking.id},data:{status:"REFUNDED",paymentStatus:"REFUNDED"}});

    return NextResponse.json({ok:true,refunds:results,totalRefunded:results.reduce((n,r)=>n+r.amount,0),completed:remaining===0});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Refund failed"},{status:400});}
}
