import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
const schema=z.object({name:z.string().min(2),slug:z.string().min(2).regex(/^[a-z0-9-]+$/),city:z.string().min(2),address:z.string().min(3),description:z.string().optional(),imageUrl:z.string().url().optional().or(z.literal("")),ownerId:z.string().optional(),active:z.boolean().optional()});
async function guard(){const u=await getCurrentUser(); return u?.role==="SUPER_ADMIN"?u:null}
export async function GET(){if(!await guard())return NextResponse.json({error:"FORBIDDEN"},{status:403});return NextResponse.json(await prisma.club.findMany({include:{owner:{select:{id:true,name:true,email:true}},_count:{select:{bookings:true,events:true,packages:true}}},orderBy:{createdAt:"desc"}}))}
export async function POST(req:Request){if(!await guard())return NextResponse.json({error:"FORBIDDEN"},{status:403});const p=schema.safeParse(await req.json());if(!p.success)return NextResponse.json({error:p.error.flatten()},{status:400});try{return NextResponse.json(await prisma.club.create({data:{...p.data,imageUrl:p.data.imageUrl||null,ownerId:p.data.ownerId||null}}),{status:201})}catch(e){return NextResponse.json({error:"Club slug or owner is already in use"},{status:409})}}
