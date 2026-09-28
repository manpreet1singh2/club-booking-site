import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(){const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});return NextResponse.json(await prisma.user.findMany({select:{id:true,name:true,email:true,phone:true,role:true,createdAt:true,_count:{select:{bookings:true}}},orderBy:{createdAt:"desc"}}))}
export async function PATCH(req:Request){const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});const b=await req.json();if(!b.id||!["CUSTOMER","CLUB_OWNER","SUPER_ADMIN","DRIVER"].includes(b.role))return NextResponse.json({error:"Invalid request"},{status:400});return NextResponse.json(await prisma.user.update({where:{id:b.id},data:{role:b.role}}))}
