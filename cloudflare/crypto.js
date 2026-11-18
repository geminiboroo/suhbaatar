const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
export function randomToken(){
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
export async function digest(value){
  return hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value));
}
export async function sign(secret,value){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}
export function equals(left,right){
  if(typeof right!=='string'||left.length!==right.length) return false;
  let difference=0;
  for(let i=0;i<left.length;i++) difference|=left.charCodeAt(i)^right.charCodeAt(i);
  return difference===0;
}
export async function passwordHash(password,salt=randomToken()){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return salt+':'+hex(bits);
}
