import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export async function GET(){
  const u=await getCurrentUser();
  if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});
  return NextResponse.json(await prisma.user.findMany({select:{id:true,name:true,email:true,phone:true,role:true,createdAt:true,_count:{select:{bookings:true}}},orderBy:{createdAt:"desc"}}));
}
export async function PATCH(req:Request){
  const u=await getCurrentUser();
  if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});
  try{
    const b=await req.json(),id=String(b.id||""),role=String(b.role||"");
    if(!id||!["CUSTOMER","CLUB_OWNER","SUPER_ADMIN","DRIVER"].includes(role))return NextResponse.json({error:"Invalid request"},{status:400});
    if(id===u.id&&role!=="SUPER_ADMIN")return NextResponse.json({error:"You cannot remove your own super-admin access"},{status:400});
    const target=await prisma.user.findUnique({where:{id},select:{id:true,role:true}});
    if(!target)return NextResponse.json({error:"User not found"},{status:404});
    if(target.role==="SUPER_ADMIN"&&role!=="SUPER_ADMIN"&&await prisma.user.count({where:{role:"SUPER_ADMIN"}})<=1)return NextResponse.json({error:"At least one super admin must remain"},{status:400});
    const updated=await prisma.user.update({where:{id},data:{role:role as never},select:{id:true,name:true,email:true,phone:true,role:true,createdAt:true}});
    await writeAuditLog({userId:u.id,action:"ROLE_CHANGED",entity:"User",entityId:id,metadata:{from:target.role,to:role}});
    return NextResponse.json(updated);
  }catch{return NextResponse.json({error:"Unable to update user role"},{status:400});}
}
