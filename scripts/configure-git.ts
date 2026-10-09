import {execFileSync} from "node:child_process";
import "./cloud-admin";
const response=await fetch("https://api.github.com/user",{headers:{Authorization:"Bearer "+process.env.GITHUB_ACCESS_TOKEN,"User-Agent":"UpKeepHR"}});
if(!response.ok)throw new Error("No se pudo verificar la identidad de GitHub.");
const user=await response.json();if(!/^[a-z\d-]+$/i.test(user.login)||!Number.isInteger(user.id))throw new Error("Identidad de GitHub inválida.");
execFileSync("git",["config","user.name",user.login]);execFileSync("git",["config","user.email",user.id+"+"+user.login+"@users.noreply.github.com"]);console.log("Autor Git configurado con la identidad verificada.");
