import {NextResponse} from "next/server";
import {getCurrentUser} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
export async function GET(){const u=await getCurrentUser();if(!u||!["SUPER_ADMIN","CLUB_OWNER"].includes(u.role))return NextResponse.json({error:"FORBIDDEN"},{status:403});const clubs=await prisma.club.findMany({where:u.role==="CLUB_OWNER"?{ownerId:u.id}:{} ,select:{id:true,name:true,city:true,active:true},orderBy:{name:"asc"}});return NextResponse.json(clubs,{headers:{"Cache-Control":"private, no-store, max-age=0"}})}