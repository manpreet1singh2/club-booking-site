import {NextResponse} from "next/server";
import {getCurrentUser,isSameOrigin} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import { profileUpdateSchema } from "@/lib/validation";
function normalizePhone(value:unknown){if(value==null||value==="")return null;const phone=String(value).trim().replace(/[\s()-]/g,"");if(!/^\+?[1-9]\d{7,14}$/.test(phone))throw new Error("Enter a valid phone number");return phone}
export async function GET(){
  const u=await getCurrentUser();
  if(!u)return NextResponse.json({error:"Authentication required"},{status:401});
  const response=NextResponse.json({id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role});
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  return response;
}
export async function PATCH(req:Request){
  if(!isSameOrigin(req))return NextResponse.json({error:"Invalid request origin"},{status:403});const u=await getCurrentUser();if(!u)return NextResponse.json({error:"Authentication required"},{status:401});try{const parsed=profileUpdateSchema.safeParse(await req.json());if(!parsed.success)return NextResponse.json({error:"Invalid profile update"},{status:400});const name=parsed.data.name;const phone=normalizePhone(parsed.data.phone);const updated=await prisma.user.update({where:{id:u.id},data:{name,phone},select:{id:true,name:true,email:true,phone:true,role:true}});const response=NextResponse.json({id:updated.id,name:updated.name,email:updated.email,phone:updated.phone,role:updated.role});response.headers.set("Cache-Control","private, no-store, max-age=0");return response}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Unable to update profile"},{status:400})}}