import crypto from "crypto";
export function hashPassword(password:string){const salt=crypto.randomBytes(16).toString("hex");const hash=crypto.scryptSync(password,salt,64).toString("hex");return salt+":"+hash;}
export function verifyPassword(password:string,stored:string){const [salt,key]=stored.split(":");if(!salt||!key)return false;const hash=crypto.scryptSync(password,salt,64);return crypto.timingSafeEqual(hash,Buffer.from(key,"hex"));}
export function createSessionToken(){return crypto.randomBytes(32).toString("hex");}
