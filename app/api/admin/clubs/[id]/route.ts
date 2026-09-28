import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});const id=(await params).id;const body=await req.json();const club=await prisma.club.update({where:{id},data:{name:body.name,slug:body.slug,city:body.city,address:body.address,description:body.description,imageUrl:body.imageUrl||null,ownerId:body.ownerId||null,active:body.active}});return NextResponse.json(club)}
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){const u=await getCurrentUser();if(u?.role!=="SUPER_ADMIN")return NextResponse.json({error:"FORBIDDEN"},{status:403});const id=(await params).id;const club=await prisma.club.update({where:{id},data:{active:false}});return NextResponse.json(club)}
