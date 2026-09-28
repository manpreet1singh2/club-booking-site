import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});const body=await req.json();return NextResponse.json(await prisma.driver.update({where:{id:(await params).id},data:{vehicleType:body.vehicleType,vehicleNumber:body.vehicleNumber||null,available:Boolean(body.available)}}))}
