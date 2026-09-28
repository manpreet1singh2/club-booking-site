import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});const id=(await params).id,body=await req.json();return NextResponse.json(await prisma.package.update({where:{id},data:{clubId:body.clubId,name:body.name,description:body.description,price:Number(body.price),active:Boolean(body.active)}}))}
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});return NextResponse.json(await prisma.package.update({where:{id:(await params).id},data:{active:false}}))}
