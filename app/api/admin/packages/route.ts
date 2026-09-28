import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
const schema=z.object({clubId:z.string().min(1),name:z.string().min(2),description:z.string().optional(),price:z.coerce.number().positive(),pricing:z.enum(["PER_PERSON","FLAT"]).default("PER_PERSON"),active:z.boolean().optional()});
async function guard(){const u=await getCurrentUser();return u?.role==="SUPER_ADMIN"?u:null}
export async function GET(){if(!await guard())return NextResponse.json({error:"FORBIDDEN"},{status:403});return NextResponse.json(await prisma.package.findMany({include:{club:true,_count:{select:{bookings:true}}},orderBy:{createdAt:"desc"}}))}
export async function POST(req:Request){if(!await guard())return NextResponse.json({error:"FORBIDDEN"},{status:403});const p=schema.safeParse(await req.json());if(!p.success)return NextResponse.json({error:p.error.flatten()},{status:400});return NextResponse.json(await prisma.package.create({data:p.data}),{status:201})}
