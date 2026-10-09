import { NextRequest,NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activationHash } from "@/lib/platform-users";
import { mutationGuard } from "@/lib/auth";
export async function POST(request:NextRequest) {
 try {mutationGuard(request);const {token}=await request.json();if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token))throw new Error();const row=await db.activation.findUnique({where:{tokenHash:activationHash(token)}});if(!row||row.consumedAt||row.expiresAt<new Date())throw new Error();const user=row.userId?await db.platformUser.findUnique({where:{id:row.userId},select:{name:true,email:true}}):null;return NextResponse.json({purpose:row.purpose,...user},{headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({error:"Enlace utilizado, vencido o inválido."},{status:400});}
}
