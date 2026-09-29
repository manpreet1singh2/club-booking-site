import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
const schema=z.object({name:z.string().trim().min(2).max(120),slug:z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),city:z.string().trim().min(2).max(80),address:z.string().trim().min(3).max(300),description:z.string().max(1000).optional(),imageUrl:z.string().url().optional().or(z.literal("")),ownerId:z.string().optional(),active:z.boolean().optional()});
async function guard(){const u=await getCurrentUser(); return u?.role==="SUPER_ADMIN"?u:null}
async function validateOwner(ownerId?:string){if(!ownerId)return null;const owner=await prisma.user.findUnique({where:{id:ownerId},select:{id:true,role:true}});if(!owner||owner.role!=="CLUB_OWNER")throw new Error("Owner must be a club owner");return owner.id}
export async function GET(){if(!await guard())return NextResponse.json({error:"FORBIDDEN"},{status:403});return NextResponse.json(await prisma.club.findMany({include:{owner:{select:{id:true,name:true,email:true}},_count:{select:{bookings:true,events:true,packages:true}}},orderBy:{createdAt:"desc"}}))}
export async function POST(req:Request){if(!await guard())return NextResponse.json({error:"FORBIDDEN"},{status:403});const p=schema.safeParse(await req.json());if(!p.success)return NextResponse.json({error:p.error.flatten()},{status:400});try{const ownerId=await validateOwner(p.data.ownerId);return NextResponse.json(await prisma.club.create({data:{...p.data,imageUrl:p.data.imageUrl||null,ownerId}}),{status:201})}catch(e){return NextResponse.json({error:"Club slug or owner is already in use"},{status:409})}}
