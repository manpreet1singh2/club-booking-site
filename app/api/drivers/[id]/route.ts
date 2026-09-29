import {NextResponse} from "next/server";
import {getCurrentUser} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});
 const id=(await params).id;const body=await req.json();
 const existing=await prisma.driver.findUnique({where:{id},include:{assignments:{where:{status:{notIn:["COMPLETED","CANCELLED"]}},select:{id:true}}}});
 if(!existing)return NextResponse.json({error:"Driver not found"},{status:404});
 if(body.available===true&&existing.assignments.length)return NextResponse.json({error:"Driver has an active transport assignment"},{status:409});
 const data:any={vehicleType:body.vehicleType==="BIKE"?"BIKE":"CAB",vehicleNumber:body.vehicleNumber?String(body.vehicleNumber).trim():null};
 if(body.available!==undefined)data.available=Boolean(body.available);
 return NextResponse.json(await prisma.driver.update({where:{id},data}));
}