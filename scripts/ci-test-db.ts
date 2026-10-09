import fs from "node:fs/promises";
import {Pool} from "pg";
if(process.env.CI!=="true"||process.env.DATABASE_SCHEMA!=="hhrr_test")throw new Error("Only CI isolated PostgreSQL setup.");
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try{await pool.query('CREATE SCHEMA IF NOT EXISTS hhrr_test');const connection=await pool.connect();try{await connection.query('BEGIN; SET LOCAL search_path TO hhrr_test;');for(const file of (await fs.readdir("prisma/cloud")).filter(f=>f.endsWith(".sql")).sort()){const sql=(await fs.readFile(`prisma/cloud/${file}`,"utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";',"");await connection.query(sql);}await connection.query('COMMIT');}finally{connection.release();}}finally{await pool.end();}
