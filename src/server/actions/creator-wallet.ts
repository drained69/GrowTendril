"use server";
import { currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { fail, limited, type ActionResult } from "@/server/actions/_common";
import { beginRecipientChallenge, verifyRecipientChallenge } from "@/server/domain/growth/creator-wallet";
async function creatorContext() { const user = await currentUser(); if (!user?.emailVerified) throw new Error("Sign in and verify your email first"); await limited(`creator-wallet:${user.id}`,5,0.05); return { user, db:await getDb() }; }
export async function beginCreatorWalletAction(token: string, address: string): Promise<ActionResult<{id:string;message:string}>> {
  try { const {user,db}=await creatorContext(); return {ok:true,data:await beginRecipientChallenge(db,user.id,token,address)}; } catch(e) {return fail(e);}
}
export async function verifyCreatorWalletAction(id:string,signature:string):Promise<ActionResult> {
  try {const {user,db}=await creatorContext(); await verifyRecipientChallenge(db,user.id,id,signature); return {ok:true,message:"Payout wallet control confirmed"};}catch(e){return fail(e);}
}
