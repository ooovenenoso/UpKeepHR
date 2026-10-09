import fs from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {cloudDirectory,readCloudState} from "./cloud-admin";
const state=readCloudState();
if(!process.env.GITHUB_ACCESS_TOKEN||!process.env.VERCEL_ACCESS_TOKEN||!state.projectId||!state.repoId||!state.repository||!state.teamId||!state.projectName)throw new Error("Configure las credenciales y ejecute provision antes de desplegar.");
const gitEnv={...process.env,GIT_TERMINAL_PROMPT:"0",GIT_TRACE:"0",GIT_TRACE_CURL:"0",GIT_CONFIG_COUNT:"2",GIT_CONFIG_KEY_0:"http.https://github.com/.extraheader",GIT_CONFIG_VALUE_0:"AUTHORIZATION: basic "+Buffer.from("x-access-token:"+process.env.GITHUB_ACCESS_TOKEN).toString("base64"),GIT_CONFIG_KEY_1:"credential.helper",GIT_CONFIG_VALUE_1:""};
const git=(...args:string[])=>execFileSync("git",args,{env:gitEnv,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const names=git("ls-files").split("\n");if(names.some(n=>/(^|\/)(\.env(?!\.example)|test-results|\.next|node_modules|.*\.sqlite|activar-superadmin)/.test(n)))throw new Error("Archivo privado incluido en Git.");
try{git("remote","get-url","origin");}catch{git("remote","add","origin","https://github.com/"+state.repository+".git");}
git("push","-u","origin","main");
const sha=git("rev-parse","HEAD");
const response=await fetch("https://api.vercel.com/v13/deployments?teamId="+state.teamId,{method:"POST",headers:{Authorization:"Bearer "+process.env.VERCEL_ACCESS_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({name:state.projectName,project:state.projectId,target:"production",gitSource:{type:"github",repoId:Number(state.repoId),ref:sha}})});
const deployment=await response.json();if(!response.ok)throw new Error("Vercel: HTTP "+response.status);
await fs.writeFile(path.join(cloudDirectory,"deployment.json"),JSON.stringify({id:deployment.id,url:deployment.url,sha,createdAt:new Date().toISOString()}));
console.log(JSON.stringify({deploymentId:deployment.id,url:"https://"+deployment.url,state:deployment.readyState??deployment.status,sha}));
